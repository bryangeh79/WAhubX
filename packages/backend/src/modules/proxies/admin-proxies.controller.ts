import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ProxyEntity, ProxyStatus } from './proxy.entity';
import { CreateProxyDto } from './dto/create-proxy.dto';
import { UpdateProxyDto } from './dto/update-proxy.dto';
import { CurrentUser, type RequestUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserRole } from '../users/user.entity';
import { buildProxyAgent, type ProxyDescriptor } from '../../common/proxy-config';

// Admin 代理池管理
// 2026-04-22 · 加 PATCH (编辑) · POST :id/test (延迟测) · 列表带占用 slot 数
@Controller({ path: 'admin/proxies', version: '1' })
@UseGuards(RolesGuard)
@Roles(UserRole.Admin)
export class AdminProxiesController {
  constructor(
    @InjectRepository(ProxyEntity)
    private readonly proxyRepo: Repository<ProxyEntity>,
    private readonly dataSource: DataSource,
  ) {}

  @Get()
  async list(@CurrentUser() cur: RequestUser) {
    const proxies =
      cur.tenantId !== null
        ? await this.proxyRepo.find({ where: { tenantId: cur.tenantId }, order: { id: 'ASC' } })
        : await this.proxyRepo.find({ order: { id: 'ASC' } });

    // 2026-04-22 · 附上每个 proxy 实际占用的 slot 列表 (slot_index · 不是 DB id)
    const ids = proxies.map((p) => p.id);
    const usage: Array<{ proxy_id: number; slot_index: number }> =
      ids.length > 0
        ? await this.dataSource.query(
            `SELECT proxy_id, slot_index FROM account_slot
             WHERE proxy_id = ANY($1::int[]) ORDER BY slot_index ASC`,
            [ids],
          )
        : [];
    const usageMap = new Map<number, number[]>();
    for (const u of usage) {
      const arr = usageMap.get(u.proxy_id) ?? [];
      arr.push(u.slot_index);
      usageMap.set(u.proxy_id, arr);
    }

    return proxies.map((p) => ({
      ...p,
      inUseSlotIndexes: usageMap.get(p.id) ?? [],
      inUseCount: (usageMap.get(p.id) ?? []).length,
    }));
  }

  @Post()
  async create(@CurrentUser() cur: RequestUser, @Body() dto: CreateProxyDto) {
    if (cur.tenantId === null) {
      throw new BadRequestException('平台超管需指定租户 — 请用租户 admin 建代理');
    }
    const proxy = this.proxyRepo.create({
      tenantId: cur.tenantId,
      proxyType: dto.proxyType,
      host: dto.host,
      port: dto.port,
      username: dto.username ?? null,
      password: dto.password ?? null,
      country: dto.country ?? null,
      city: dto.city ?? null,
      status: ProxyStatus.Unknown,
      boundSlotIds: [],
    });
    return this.proxyRepo.save(proxy);
  }

  @Patch(':id')
  async update(
    @CurrentUser() cur: RequestUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateProxyDto,
  ) {
    const proxy = await this.proxyRepo.findOne({ where: { id } });
    if (!proxy) throw new NotFoundException(`代理 ${id} 不存在`);
    if (cur.tenantId !== null && proxy.tenantId !== cur.tenantId) {
      throw new BadRequestException('无权限编辑该代理');
    }
    if (dto.proxyType !== undefined) proxy.proxyType = dto.proxyType;
    if (dto.host !== undefined) proxy.host = dto.host;
    if (dto.port !== undefined) proxy.port = dto.port;
    if (dto.username !== undefined) proxy.username = dto.username || null;
    if (dto.password !== undefined) proxy.password = dto.password || null;
    if (dto.country !== undefined) proxy.country = dto.country || null;
    if (dto.city !== undefined) proxy.city = dto.city || null;
    // 编辑后状态回到 unknown · 租户需重新测速
    proxy.status = ProxyStatus.Unknown;
    proxy.lastCheckAt = null;
    proxy.avgLatencyMs = null;
    return this.proxyRepo.save(proxy);
  }

  // POST /admin/proxies/:id/test · 测延迟 · 通过代理 fetch https://api.ipify.org
  @Post(':id/test')
  @HttpCode(HttpStatus.OK)
  async test(@CurrentUser() cur: RequestUser, @Param('id', ParseIntPipe) id: number) {
    const proxy = await this.proxyRepo.findOne({ where: { id } });
    if (!proxy) throw new NotFoundException(`代理 ${id} 不存在`);
    if (cur.tenantId !== null && proxy.tenantId !== cur.tenantId) {
      throw new BadRequestException('无权限测试该代理');
    }

    const desc: ProxyDescriptor = {
      type: proxy.proxyType as ProxyDescriptor['type'],
      host: proxy.host,
      port: proxy.port,
      username: proxy.username,
      password: proxy.password,
    };
    const agent = buildProxyAgent(desc);
    const start = Date.now();
    let ok = false;
    let egressIp: string | null = null;
    let errMsg: string | null = null;

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      const res = await fetch('https://api.ipify.org?format=json', {
        agent,
        signal: controller.signal,
      } as unknown as RequestInit);
      clearTimeout(timer);
      if (res.ok) {
        const json = (await res.json()) as { ip?: string };
        egressIp = json.ip ?? null;
        ok = true;
      } else {
        errMsg = `HTTP ${res.status}`;
      }
    } catch (err) {
      errMsg = err instanceof Error ? err.message : String(err);
    }
    const latencyMs = Date.now() - start;

    // 更新 DB
    proxy.status = ok ? ProxyStatus.Ok : ProxyStatus.Down;
    proxy.lastCheckAt = new Date();
    proxy.avgLatencyMs = ok ? latencyMs : null;
    await this.proxyRepo.save(proxy);

    return { ok, latencyMs, egressIp, error: errMsg };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() cur: RequestUser, @Param('id', ParseIntPipe) id: number) {
    const proxy = await this.proxyRepo.findOne({ where: { id } });
    if (!proxy) throw new NotFoundException(`代理 ${id} 不存在`);
    if (cur.tenantId !== null && proxy.tenantId !== cur.tenantId) {
      throw new BadRequestException('无权限删除该代理');
    }
    // 2026-04-22 · 占用中禁止删 · 避免槽位失去代理
    const used: Array<{ cnt: string }> = await this.dataSource.query(
      `SELECT COUNT(*)::text AS cnt FROM account_slot WHERE proxy_id = $1`,
      [id],
    );
    const cnt = parseInt(used[0]?.cnt ?? '0', 10);
    if (cnt > 0) {
      throw new BadRequestException(`该代理被 ${cnt} 个槽位使用 · 请先解绑后再删`);
    }
    await this.proxyRepo.remove(proxy);
  }
}
