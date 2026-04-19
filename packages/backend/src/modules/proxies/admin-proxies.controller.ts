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
  Post,
  UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProxyEntity, ProxyStatus } from './proxy.entity';
import { CreateProxyDto } from './dto/create-proxy.dto';
import { CurrentUser, type RequestUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserRole } from '../users/user.entity';

// Admin 代理池管理 (M3 会加代理健康检查 cron; 此处先做 CRUD 基础设施)
@Controller({ path: 'admin/proxies', version: '1' })
@UseGuards(RolesGuard)
@Roles(UserRole.Admin)
export class AdminProxiesController {
  constructor(
    @InjectRepository(ProxyEntity)
    private readonly proxyRepo: Repository<ProxyEntity>,
  ) {}

  @Get()
  async list(@CurrentUser() cur: RequestUser) {
    // 租户 admin 只看自己租户; 平台超管 (tenantId=null) 看全部
    if (cur.tenantId !== null) {
      return this.proxyRepo.find({ where: { tenantId: cur.tenantId }, order: { id: 'ASC' } });
    }
    return this.proxyRepo.find({ order: { id: 'ASC' } });
  }

  @Post()
  async create(@CurrentUser() cur: RequestUser, @Body() dto: CreateProxyDto) {
    if (cur.tenantId === null) {
      throw new BadRequestException('平台超管需指定租户 — M3 再做跨租户代理分发; 现用租户 admin 建');
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

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() cur: RequestUser, @Param('id', ParseIntPipe) id: number) {
    const proxy = await this.proxyRepo.findOne({ where: { id } });
    if (!proxy) throw new NotFoundException(`代理 ${id} 不存在`);
    if (cur.tenantId !== null && proxy.tenantId !== cur.tenantId) {
      throw new BadRequestException('无权限删除该代理');
    }
    // TODO(M3): 若该 proxy 还被 slot 绑定则应先解绑 OR 拒绝删除. 现暂不阻拦.
    await this.proxyRepo.remove(proxy);
  }
}
