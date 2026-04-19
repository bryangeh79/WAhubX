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
