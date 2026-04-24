import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ExecutionGroupEntity } from './execution-group.entity';
import { AccountSlotEntity } from '../slots/account-slot.entity';
import type { CreateGroupDto } from './dto/create-group.dto';
import type { UpdateGroupDto } from './dto/update-group.dto';

export interface GroupSummary {
  id: number;
  name: string;
  description: string | null;
  memberCount: number;
  ipDistribution: Record<string, number>; // proxy_id (或 'direct') → count · 前端据此显 IP 分布
  duplicateIpGroups: Array<{ proxyKey: string; slotIds: number[] }>; // 同 IP 警告用
  slotIds: number[];
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class ExecutionGroupsService {
  constructor(
    @InjectRepository(ExecutionGroupEntity)
    private readonly groupRepo: Repository<ExecutionGroupEntity>,
    @InjectRepository(AccountSlotEntity)
    private readonly slotRepo: Repository<AccountSlotEntity>,
  ) {}

  async listForTenant(tenantId: number): Promise<GroupSummary[]> {
    const groups = await this.groupRepo.find({
      where: { tenantId },
      relations: ['slots'],
      order: { createdAt: 'ASC' },
    });
    return groups.map((g) => this.toSummary(g));
  }

  async getOne(id: number, tenantId: number): Promise<GroupSummary> {
    const g = await this.groupRepo.findOne({ where: { id }, relations: ['slots'] });
    if (!g) throw new NotFoundException(`组 ${id} 不存在`);
    if (g.tenantId !== tenantId) throw new ForbiddenException('无权访问他租户的组');
    return this.toSummary(g);
  }

  async create(tenantId: number, dto: CreateGroupDto): Promise<GroupSummary> {
    await this.assertSlotsBelongToTenant(tenantId, dto.slotIds);
    const group = this.groupRepo.create({
      tenantId,
      name: dto.name,
      description: dto.description ?? null,
    });
    const slots = await this.slotRepo.find({ where: { id: In(dto.slotIds) } });
    group.slots = slots;
    const saved = await this.groupRepo.save(group);
    const reloaded = await this.groupRepo.findOne({
      where: { id: saved.id },
      relations: ['slots'],
    });
    return this.toSummary(reloaded!);
  }

  async update(id: number, tenantId: number, dto: UpdateGroupDto): Promise<GroupSummary> {
    const g = await this.groupRepo.findOne({ where: { id }, relations: ['slots'] });
    if (!g) throw new NotFoundException(`组 ${id} 不存在`);
    if (g.tenantId !== tenantId) throw new ForbiddenException('无权修改他租户的组');
    if (dto.name !== undefined) g.name = dto.name;
    if (dto.description !== undefined) g.description = dto.description;
    if (dto.slotIds !== undefined) {
      await this.assertSlotsBelongToTenant(tenantId, dto.slotIds);
      g.slots = await this.slotRepo.find({ where: { id: In(dto.slotIds) } });
    }
    await this.groupRepo.save(g);
    const reloaded = await this.groupRepo.findOne({ where: { id }, relations: ['slots'] });
    return this.toSummary(reloaded!);
  }

  async remove(id: number, tenantId: number): Promise<void> {
    const g = await this.groupRepo.findOne({ where: { id } });
    if (!g) throw new NotFoundException(`组 ${id} 不存在`);
    if (g.tenantId !== tenantId) throw new ForbiddenException('无权删除他租户的组');
    await this.groupRepo.remove(g);
  }

  /**
   * 检查一批 slotIds 里的 proxy 重复情况 · 用于 UI 创建前预警
   */
  checkIpConflicts(slotIds: number[], slots: AccountSlotEntity[]): Array<{ proxyKey: string; slotIds: number[] }> {
    const bucket = new Map<string, number[]>();
    for (const s of slots) {
      if (!slotIds.includes(s.id)) continue;
      const key = s.proxyId === null ? 'direct' : `proxy:${s.proxyId}`;
      const arr = bucket.get(key) ?? [];
      arr.push(s.id);
      bucket.set(key, arr);
    }
    const conflicts: Array<{ proxyKey: string; slotIds: number[] }> = [];
    for (const [k, v] of bucket) {
      if (v.length >= 2) conflicts.push({ proxyKey: k, slotIds: v });
    }
    return conflicts;
  }

  /**
   * 展开 groupId → slotIds (用于任务调度 `slotSource='group'` 场景)
   */
  async expandGroupToSlotIds(groupId: number, tenantId: number): Promise<number[]> {
    const g = await this.getOne(groupId, tenantId);
    return g.slotIds;
  }

  private async assertSlotsBelongToTenant(tenantId: number, slotIds: number[]): Promise<void> {
    if (slotIds.length === 0) return;
    const slots = await this.slotRepo.find({ where: { id: In(slotIds) } });
    if (slots.length !== slotIds.length) {
      throw new BadRequestException('部分槽位不存在');
    }
    for (const s of slots) {
      if (s.tenantId !== tenantId) {
        throw new ForbiddenException(`槽位 ${s.id} 不属于当前租户`);
      }
    }
  }

  private toSummary(g: ExecutionGroupEntity): GroupSummary {
    const slots = g.slots ?? [];
    const slotIds = slots.map((s) => s.id);
    const ipBuckets: Record<string, number> = {};
    for (const s of slots) {
      const key = s.proxyId === null ? 'direct' : `proxy:${s.proxyId}`;
      ipBuckets[key] = (ipBuckets[key] ?? 0) + 1;
    }
    const dup = this.checkIpConflicts(slotIds, slots);
    return {
      id: g.id,
      name: g.name,
      description: g.description,
      memberCount: slots.length,
      ipDistribution: ipBuckets,
      duplicateIpGroups: dup,
      slotIds,
      createdAt: g.createdAt,
      updatedAt: g.updatedAt,
    };
  }
}
