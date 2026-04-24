import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { CustomerGroupEntity } from '../entities/customer-group.entity';
import {
  CustomerGroupMemberEntity,
  CustomerMemberSource,
  MemberSendStatus,
} from '../entities/customer-group-member.entity';
import {
  CreateCustomerGroupDto,
  ImportPasteDto,
  PickContactsDto,
  UpdateCustomerGroupDto,
} from '../dto/customer-group.dto';
import { jidToPhone, normalizePhone, parsePhoneBlob } from '../utils/phone';
import { WaContactEntity } from '../../baileys/wa-contact.entity';

export interface ImportResult {
  added: number;
  skippedDuplicate: number;
  skippedInvalid: number;
  total: number;
}

@Injectable()
export class CustomerGroupsService {
  constructor(
    @InjectRepository(CustomerGroupEntity)
    private readonly groupRepo: Repository<CustomerGroupEntity>,
    @InjectRepository(CustomerGroupMemberEntity)
    private readonly memberRepo: Repository<CustomerGroupMemberEntity>,
    @InjectRepository(WaContactEntity)
    private readonly contactRepo: Repository<WaContactEntity>,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  // ──────────────────────────────────────────────────────────────
  // Group CRUD
  // ──────────────────────────────────────────────────────────────

  async list(tenantId: number): Promise<Array<CustomerGroupEntity & { badCount: number; okCount: number }>> {
    const groups = await this.groupRepo.find({ where: { tenantId }, order: { createdAt: 'DESC' } });
    if (groups.length === 0) return [];
    // 聚合每组坏号数
    const rows = await this.dataSource.query<Array<{ group_id: number; bad_count: string; ok_count: string }>>(
      `
      SELECT group_id,
        SUM(CASE WHEN send_status != 0 THEN 1 ELSE 0 END) as bad_count,
        SUM(CASE WHEN send_status = 0 THEN 1 ELSE 0 END) as ok_count
      FROM customer_group_member
      WHERE group_id = ANY($1::int[])
      GROUP BY group_id
      `,
      [groups.map((g) => g.id)],
    );
    const map = new Map<number, { bad: number; ok: number }>();
    for (const r of rows) map.set(Number(r.group_id), { bad: Number(r.bad_count), ok: Number(r.ok_count) });
    return groups.map((g) => {
      const s = map.get(g.id) ?? { bad: 0, ok: 0 };
      return Object.assign(g, { badCount: s.bad, okCount: s.ok });
    });
  }

  async findById(tenantId: number, id: number): Promise<CustomerGroupEntity> {
    const row = await this.groupRepo.findOne({ where: { tenantId, id } });
    if (!row) throw new NotFoundException(`客户群 ${id} 不存在`);
    return row;
  }

  async create(tenantId: number, dto: CreateCustomerGroupDto): Promise<CustomerGroupEntity> {
    const exists = await this.groupRepo.findOne({ where: { tenantId, name: dto.name } });
    if (exists) throw new BadRequestException(`客户群 "${dto.name}" 已存在`);
    return this.groupRepo.save(
      this.groupRepo.create({
        tenantId,
        name: dto.name,
        description: dto.description ?? null,
        memberCount: 0,
      }),
    );
  }

  async update(tenantId: number, id: number, dto: UpdateCustomerGroupDto): Promise<CustomerGroupEntity> {
    const row = await this.findById(tenantId, id);
    if (dto.name !== undefined) {
      const exists = await this.groupRepo.findOne({ where: { tenantId, name: dto.name } });
      if (exists && exists.id !== id) throw new BadRequestException(`客户群 "${dto.name}" 已存在`);
      row.name = dto.name;
    }
    if (dto.description !== undefined) row.description = dto.description;
    return this.groupRepo.save(row);
  }

  async remove(tenantId: number, id: number): Promise<void> {
    const row = await this.findById(tenantId, id);
    await this.groupRepo.remove(row);
  }

  // ──────────────────────────────────────────────────────────────
  // Member 管理
  // ──────────────────────────────────────────────────────────────

  async listMembers(tenantId: number, groupId: number, page = 1, pageSize = 50) {
    await this.findById(tenantId, groupId); // 鉴权 + 存在
    const [rows, total] = await this.memberRepo.findAndCount({
      where: { groupId },
      order: { createdAt: 'DESC' },
      take: pageSize,
      skip: (page - 1) * pageSize,
    });
    return { items: rows, total, page, pageSize };
  }

  /**
   * 粘贴号码导入 · source=Paste
   */
  async importPaste(tenantId: number, groupId: number, dto: ImportPasteDto): Promise<ImportResult> {
    await this.findById(tenantId, groupId);
    const phones = parsePhoneBlob(dto.raw);
    if (phones.length === 0) {
      return { added: 0, skippedDuplicate: 0, skippedInvalid: 0, total: 0 };
    }

    const existing = await this.memberRepo.find({
      where: { groupId, phoneE164: In(phones) },
      select: ['phoneE164'],
    });
    const existSet = new Set(existing.map((e) => e.phoneE164));
    const toAdd = phones.filter((p) => !existSet.has(p));

    if (toAdd.length === 0) {
      return { added: 0, skippedDuplicate: phones.length, skippedInvalid: 0, total: phones.length };
    }

    const rows = toAdd.map((p) =>
      this.memberRepo.create({
        groupId,
        phoneE164: p,
        contactId: null,
        isFriend: null,
        source: CustomerMemberSource.Paste,
      }),
    );
    await this.memberRepo.save(rows);
    await this.syncMemberCount(groupId);

    return {
      added: toAdd.length,
      skippedDuplicate: existSet.size,
      skippedInvalid: 0,
      total: phones.length,
    };
  }

  /**
   * CSV 导入 · 逐行解析, 首列为手机号 (允许有表头)
   * service 直接吞 raw 字符串, 不依赖 multipart
   */
  async importCsv(tenantId: number, groupId: number, raw: string): Promise<ImportResult> {
    await this.findById(tenantId, groupId);
    const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const phones: string[] = [];
    let invalid = 0;
    for (const line of lines) {
      // 支持逗号 / tab / 分号分隔 · 第一列认为是手机号
      const firstCol = line.split(/[,\t;]/)[0].trim();
      // 跳过明显表头
      if (/^(phone|手机|号码|电话|mobile|number)/i.test(firstCol)) continue;
      const n = normalizePhone(firstCol);
      if (n) phones.push(n);
      else invalid++;
    }

    const uniq = [...new Set(phones)];
    const existing = await this.memberRepo.find({
      where: { groupId, phoneE164: In(uniq) },
      select: ['phoneE164'],
    });
    const existSet = new Set(existing.map((e) => e.phoneE164));
    const toAdd = uniq.filter((p) => !existSet.has(p));
    const rows = toAdd.map((p) =>
      this.memberRepo.create({
        groupId,
        phoneE164: p,
        contactId: null,
        isFriend: null,
        source: CustomerMemberSource.CsvImport,
      }),
    );
    if (rows.length > 0) await this.memberRepo.save(rows);
    await this.syncMemberCount(groupId);

    return {
      added: toAdd.length,
      skippedDuplicate: existSet.size,
      skippedInvalid: invalid,
      total: lines.length,
    };
  }

  /**
   * 从 wa_contact 挑选 · source=ContactPicked
   * contactIds 必须是本租户某 wa_account 的联系人 (不强制校验, 上游已过滤)
   */
  async pickContacts(tenantId: number, groupId: number, dto: PickContactsDto): Promise<ImportResult> {
    await this.findById(tenantId, groupId);
    if (dto.contactIds.length === 0) return { added: 0, skippedDuplicate: 0, skippedInvalid: 0, total: 0 };

    const contacts = await this.contactRepo.find({
      where: { id: In(dto.contactIds) },
    });

    let invalid = 0;
    const seen = new Set<string>();
    const pairs: Array<{ phoneE164: string; contactId: number }> = [];
    for (const c of contacts) {
      const phone = jidToPhone(c.remoteJid);
      if (!phone) {
        invalid++;
        continue;
      }
      if (seen.has(phone)) continue;
      seen.add(phone);
      pairs.push({ phoneE164: phone, contactId: c.id });
    }

    const existing = await this.memberRepo.find({
      where: { groupId, phoneE164: In(pairs.map((p) => p.phoneE164)) },
      select: ['phoneE164'],
    });
    const existSet = new Set(existing.map((e) => e.phoneE164));
    const toAdd = pairs.filter((p) => !existSet.has(p.phoneE164));

    const rows = toAdd.map((p) =>
      this.memberRepo.create({
        groupId,
        phoneE164: p.phoneE164,
        contactId: p.contactId,
        isFriend: true, // wa_contact 里的必然是 "认识过"; 实际是否好友留 v1.1 刷新
        source: CustomerMemberSource.ContactPicked,
      }),
    );
    if (rows.length > 0) await this.memberRepo.save(rows);
    await this.syncMemberCount(groupId);

    return {
      added: toAdd.length,
      skippedDuplicate: existSet.size,
      skippedInvalid: invalid,
      total: dto.contactIds.length,
    };
  }

  async removeMember(tenantId: number, groupId: number, memberId: number): Promise<void> {
    await this.findById(tenantId, groupId);
    const row = await this.memberRepo.findOne({ where: { id: memberId, groupId } });
    if (!row) throw new NotFoundException(`成员 ${memberId} 不存在`);
    await this.memberRepo.remove(row);
    await this.syncMemberCount(groupId);
  }

  async clearMembers(tenantId: number, groupId: number): Promise<number> {
    await this.findById(tenantId, groupId);
    const del = await this.memberRepo.delete({ groupId });
    await this.syncMemberCount(groupId);
    return del.affected ?? 0;
  }

  /**
   * 克隆群 · 复制名称+描述+成员 (不复制创建时间)
   */
  async clone(tenantId: number, sourceId: number): Promise<CustomerGroupEntity> {
    const src = await this.findById(tenantId, sourceId);
    // 生成新名: "{原名} (副本)" / "(副本 2)" / ...
    const baseName = `${src.name} (副本)`;
    let newName = baseName;
    let n = 2;
    while (await this.groupRepo.findOne({ where: { tenantId, name: newName } })) {
      newName = `${src.name} (副本 ${n})`;
      n++;
    }
    const cloned = await this.groupRepo.save(
      this.groupRepo.create({
        tenantId,
        name: newName,
        description: src.description,
        memberCount: 0,
      }),
    );
    // 复制成员
    const members = await this.memberRepo.find({ where: { groupId: sourceId } });
    if (members.length > 0) {
      const rows = members.map((m) =>
        this.memberRepo.create({
          groupId: cloned.id,
          phoneE164: m.phoneE164,
          contactId: m.contactId,
          isFriend: m.isFriend,
          source: m.source,
        }),
      );
      await this.memberRepo.save(rows);
    }
    await this.syncMemberCount(cloned.id);
    return this.findById(tenantId, cloned.id);
  }

  /**
   * 列出联系人 (供挑选导入) · 按租户下所有 wa_account 过滤
   */
  async listContacts(tenantId: number, opts: { accountId?: number; keyword?: string; limit?: number }) {
    const limit = Math.min(opts.limit ?? 200, 500);
    const qb = this.contactRepo
      .createQueryBuilder('c')
      .innerJoin('wa_account', 'a', 'a.id = c.account_id')
      .where('a.tenant_id = :tenantId', { tenantId })
      .andWhere('c.remote_jid LIKE :sfx', { sfx: '%@s.whatsapp.net' }) // 只个人
      .orderBy('c.last_message_at', 'DESC', 'NULLS LAST')
      .addOrderBy('c.id', 'DESC')
      .take(limit);
    if (opts.accountId) qb.andWhere('c.account_id = :aid', { aid: opts.accountId });
    if (opts.keyword) {
      qb.andWhere('(c.display_name ILIKE :kw OR c.remote_jid ILIKE :kw)', {
        kw: `%${opts.keyword}%`,
      });
    }
    const rows = await qb.getMany();
    return rows.map((c) => ({
      id: c.id,
      accountId: c.accountId,
      phoneE164: jidToPhone(c.remoteJid) ?? '',
      displayName: c.displayName,
      lastMessageAt: c.lastMessageAt,
    }));
  }

  private async syncMemberCount(groupId: number): Promise<void> {
    const cnt = await this.memberRepo.count({ where: { groupId } });
    await this.groupRepo.update(groupId, { memberCount: cnt });
  }

  /**
   * 给定 groupIds 返回所有成员 phone_e164 (去重)
   */
  async fetchMemberPhones(tenantId: number, groupIds: number[]): Promise<string[]> {
    if (groupIds.length === 0) return [];
    // 2026-04-24 · 只取 send_status=0 的 (排除坏号/opted_out)
    const rows = await this.dataSource.query<Array<{ phone_e164: string }>>(
      `
      SELECT DISTINCT m.phone_e164
      FROM customer_group_member m
      INNER JOIN customer_group g ON g.id = m.group_id
      WHERE g.tenant_id = $1
        AND m.group_id = ANY($2::int[])
        AND m.send_status = 0
      `,
      [tenantId, groupIds],
    );
    return rows.map((r) => r.phone_e164);
  }

  /**
   * 2026-04-24 · executor 回填点
   * send-ad 成功/失败后调 · 更新该 tenant 下所有此号码的 member 行
   * (同号在多个群 → 一起受影响 · 拉黑一次处处生效)
   */
  async recordMemberSendResult(
    tenantId: number,
    phoneE164: string,
    result: { ok: boolean; errorCode?: string | null; errorMsg?: string | null },
  ): Promise<void> {
    // 先查同租户此号所有 member 行
    const rows = await this.dataSource.query<Array<{ id: number; fail_count: number; send_count: number }>>(
      `
      SELECT m.id, m.fail_count, m.send_count
      FROM customer_group_member m
      INNER JOIN customer_group g ON g.id = m.group_id
      WHERE g.tenant_id = $1 AND m.phone_e164 = $2
      `,
      [tenantId, phoneE164],
    );
    if (rows.length === 0) return;

    const now = new Date();
    if (result.ok) {
      // 成功 · 重置 fail_count · 不覆盖 send_status (之前若 opted_out 不解禁)
      await this.memberRepo
        .createQueryBuilder()
        .update()
        .set({
          sendCount: () => '"send_count" + 1',
          failCount: 0,
          lastAttemptAt: now,
          lastErrorCode: null,
          lastErrorMsg: null,
        })
        .whereInIds(rows.map((r) => r.id))
        .execute();
      return;
    }

    // 失败 · 分硬/软失败
    const code = result.errorCode ?? 'UNKNOWN';
    const msg = result.errorMsg ?? null;
    // 硬失败关键词: invalid jid / 443 / 号码无效
    const isHard =
      /invalid[- ]?jid|not[- ]?on[- ]?whatsapp|443|invalid.*number|no.*such/i.test(
        `${code} ${msg ?? ''}`,
      );

    for (const r of rows) {
      const newFail = (r.fail_count ?? 0) + 1;
      let newStatus: MemberSendStatus = MemberSendStatus.Ok;
      if (isHard) newStatus = MemberSendStatus.BadInvalid; // 硬失败 1 次就拉黑
      else if (newFail >= 3) newStatus = MemberSendStatus.BadNetwork; // 软失败 3 次拉黑

      await this.memberRepo.update(r.id, {
        failCount: newFail,
        sendStatus: newStatus,
        lastAttemptAt: now,
        lastErrorCode: code.slice(0, 32),
        lastErrorMsg: msg ? msg.slice(0, 500) : null,
      });
    }
  }

  /**
   * 人工解除坏号标记 (或反之标记 opted_out)
   */
  async setMemberStatus(
    tenantId: number,
    memberId: number,
    status: MemberSendStatus,
  ): Promise<void> {
    const row = await this.memberRepo
      .createQueryBuilder('m')
      .innerJoin('customer_group', 'g', 'g.id = m.group_id')
      .where('m.id = :id', { id: memberId })
      .andWhere('g.tenant_id = :tid', { tid: tenantId })
      .getOne();
    if (!row) throw new NotFoundException(`成员 ${memberId} 不存在或无权限`);
    await this.memberRepo.update(memberId, {
      sendStatus: status,
      failCount: status === MemberSendStatus.Ok ? 0 : row.failCount,
    });
  }
}
