import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, Repository } from 'typeorm';
import { TaskEntity, TaskStatus } from './task.entity';
import { TaskRunEntity, TaskRunStatus } from './task-run.entity';
import type { CreateTaskDto } from './dto/create-task.dto';

@Injectable()
export class TasksService {
  constructor(
    @InjectRepository(TaskEntity) private readonly taskRepo: Repository<TaskEntity>,
    @InjectRepository(TaskRunEntity) private readonly runRepo: Repository<TaskRunEntity>,
  ) {}

  async createForTenant(tenantId: number, dto: CreateTaskDto): Promise<TaskEntity> {
    const task = this.taskRepo.create({
      tenantId,
      taskType: dto.taskType,
      targetType: dto.targetType,
      targetIds: dto.targetIds,
      priority: dto.priority ?? 5,
      scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null,
      repeatRule: dto.repeatRule ?? null,
      payload: dto.payload ?? null,
      status: TaskStatus.Pending,
    });
    return this.taskRepo.save(task);
  }

  async listForTenant(tenantId: number | null, filters?: { status?: TaskStatus }): Promise<TaskEntity[]> {
    const where: FindOptionsWhere<TaskEntity> = {};
    if (tenantId !== null) where.tenantId = tenantId;
    if (filters?.status) where.status = filters.status;
    return this.taskRepo.find({
      where,
      order: { createdAt: 'DESC' },
      take: 200,
    });
  }

  async findOne(id: number, requesterTenantId: number | null): Promise<TaskEntity> {
    const task = await this.taskRepo.findOne({ where: { id } });
    if (!task) throw new NotFoundException(`任务 ${id} 不存在`);
    if (requesterTenantId !== null && task.tenantId !== requesterTenantId) {
      throw new ForbiddenException('无权限访问该任务');
    }
    return task;
  }

  async cancel(id: number, requesterTenantId: number | null): Promise<TaskEntity> {
    const task = await this.findOne(id, requesterTenantId);
    if ([TaskStatus.Done, TaskStatus.Failed, TaskStatus.Cancelled].includes(task.status)) {
      return task; // 终态不重复改
    }
    task.status = TaskStatus.Cancelled;
    return this.taskRepo.save(task);
  }

  // 2026-04-21 · 硬删 task (仅终态可删)
  async remove(id: number, requesterTenantId: number | null): Promise<void> {
    const task = await this.findOne(id, requesterTenantId);
    if (!([TaskStatus.Done, TaskStatus.Failed, TaskStatus.Cancelled] as string[]).includes(task.status)) {
      throw new ForbiddenException('只能删除已完成/失败/取消的任务 · 运行中请先取消');
    }
    await this.taskRepo.delete(task.id);
  }

  /**
   * 查该任务的所有 task_run logs (最新 run 在前)
   * 每个 log entry: { at, step, ok, meta? }
   */
  async getLogs(id: number, requesterTenantId: number | null): Promise<Array<{
    runId: number;
    startedAt: Date;
    finishedAt: Date | null;
    status: string;
    errorCode: string | null;
    errorMessage: string | null;
    logs: Array<{ at: string; step: string; ok: boolean; meta?: Record<string, unknown> }>;
  }>> {
    const task = await this.findOne(id, requesterTenantId);
    const runs = await this.runRepo.find({
      where: { taskId: task.id },
      order: { startedAt: 'DESC' },
    });
    return runs.map((r) => ({
      runId: r.id,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt,
      status: r.status,
      errorCode: r.errorCode,
      errorMessage: r.errorMessage,
      logs: (r.logs ?? []) as Array<{ at: string; step: string; ok: boolean; meta?: Record<string, unknown> }>,
    }));
  }

  /**
   * 2026-04-21 · 重跑任务 · clone 原 task 的 payload · 新 task pending
   * 不改原 task 状态 (原是 done/failed 保留历史)
   */
  async rerun(id: number, requesterTenantId: number | null): Promise<TaskEntity> {
    const original = await this.findOne(id, requesterTenantId);
    const clone = this.taskRepo.create({
      tenantId: original.tenantId,
      taskType: original.taskType,
      priority: original.priority,
      scheduledAt: null, // 立即跑
      targetType: original.targetType,
      targetIds: [...original.targetIds],
      payload: original.payload ? { ...(original.payload as Record<string, unknown>) } : {},
      status: TaskStatus.Pending,
      lastError: null,
    });
    return this.taskRepo.save(clone);
  }

  /**
   * 查该任务的聊天内容 (仅 script_chat 有意义)
   */
  async getChatMessages(id: number, requesterTenantId: number | null): Promise<Array<{
    accountId: number;
    direction: string;
    content: string | null;
    sentAt: Date;
  }>> {
    const task = await this.findOne(id, requesterTenantId);
    // A/B account ids
    const accIds: number[] = [];
    const p = (task.payload ?? {}) as { roleAaccountId?: number; roleBaccountId?: number };
    if (p.roleAaccountId) accIds.push(p.roleAaccountId);
    if (p.roleBaccountId) accIds.push(p.roleBaccountId);
    if (accIds.length === 0) return [];
    // 从 task.createdAt 起 · 过滤
    const rows: Array<{ account_id: number; direction: string; content: string | null; sent_at: Date }> =
      await this.taskRepo.manager.query(
        `SELECT account_id, direction, content, sent_at
         FROM chat_message
         WHERE account_id = ANY($1::int[])
           AND sent_at >= $2
         ORDER BY sent_at ASC`,
        [accIds, task.createdAt],
      );
    return rows.map((r) => ({
      accountId: r.account_id,
      direction: r.direction,
      content: r.content,
      sentAt: r.sent_at,
    }));
  }

  // M3.7 前端 "任务队列" Tab 的数据源
  async listRunning(tenantId: number | null) {
    // 通过 join task 过滤 tenant (运行中的 task_run 本身不带 tenant_id)
    const qb = this.runRepo
      .createQueryBuilder('r')
      .innerJoinAndMapOne('r.task', TaskEntity, 't', 't.id = r.task_id')
      .where('r.status = :s', { s: TaskRunStatus.Running });
    if (tenantId !== null) qb.andWhere('t.tenant_id = :tid', { tid: tenantId });
    return qb.orderBy('r.started_at', 'ASC').getMany();
  }

  async listQueued(tenantId: number | null) {
    const where: FindOptionsWhere<TaskEntity> = {
      status: TaskStatus.Pending,
    };
    if (tenantId !== null) where.tenantId = tenantId;
    return this.taskRepo.find({
      where,
      order: { priority: 'ASC', scheduledAt: 'ASC', createdAt: 'ASC' },
      take: 50,
    });
  }

  async listRecentFailed(tenantId: number | null) {
    const where: FindOptionsWhere<TaskEntity> = {
      status: TaskStatus.Failed,
    };
    if (tenantId !== null) where.tenantId = tenantId;
    return this.taskRepo.find({
      where,
      order: { updatedAt: 'DESC' },
      take: 20,
    });
  }
}
