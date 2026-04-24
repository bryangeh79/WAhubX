import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser, type RequestUser } from '../../auth/decorators/current-user.decorator';
import { CustomerGroupsService } from '../services/customer-groups.service';
import {
  CreateCustomerGroupDto,
  ImportPasteDto,
  PickContactsDto,
  UpdateCustomerGroupDto,
} from '../dto/customer-group.dto';
import { CampaignFeatureFlagGuard } from '../guards/feature-flag.guard';

@Controller({ path: 'customer-groups', version: '1' })
@UseGuards(CampaignFeatureFlagGuard)
export class CustomerGroupsController {
  constructor(private readonly service: CustomerGroupsService) {}

  private tenantOf(cur: RequestUser): number {
    if (cur.tenantId === null) throw new BadRequestException('请切换到租户视角');
    return cur.tenantId;
  }

  @Get()
  list(@CurrentUser() cur: RequestUser) {
    return this.service.list(this.tenantOf(cur));
  }

  @Get(':id')
  getOne(@CurrentUser() cur: RequestUser, @Param('id', ParseIntPipe) id: number) {
    return this.service.findById(this.tenantOf(cur), id);
  }

  @Post()
  create(@CurrentUser() cur: RequestUser, @Body() dto: CreateCustomerGroupDto) {
    return this.service.create(this.tenantOf(cur), dto);
  }

  @Post(':id/clone')
  clone(@CurrentUser() cur: RequestUser, @Param('id', ParseIntPipe) id: number) {
    return this.service.clone(this.tenantOf(cur), id);
  }

  // 供挑选联系人 UI 用 · 列出租户下的 wa_contact
  @Get('contacts/list')
  listContacts(
    @CurrentUser() cur: RequestUser,
    @Query('accountId') accountId?: string,
    @Query('keyword') keyword?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.listContacts(this.tenantOf(cur), {
      accountId: accountId ? Number(accountId) : undefined,
      keyword: keyword?.trim() || undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Patch(':id')
  update(
    @CurrentUser() cur: RequestUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCustomerGroupDto,
  ) {
    return this.service.update(this.tenantOf(cur), id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() cur: RequestUser, @Param('id', ParseIntPipe) id: number) {
    await this.service.remove(this.tenantOf(cur), id);
  }

  // ── 成员管理 ────────────────────────────────────────────

  @Get(':id/members')
  listMembers(
    @CurrentUser() cur: RequestUser,
    @Param('id', ParseIntPipe) id: number,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.service.listMembers(this.tenantOf(cur), id, page ? Number(page) : 1, pageSize ? Number(pageSize) : 50);
  }

  @Post(':id/members/import-paste')
  importPaste(
    @CurrentUser() cur: RequestUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ImportPasteDto,
  ) {
    return this.service.importPaste(this.tenantOf(cur), id, dto);
  }

  @Post(':id/members/import-csv')
  importCsv(
    @CurrentUser() cur: RequestUser,
    @Param('id', ParseIntPipe) id: number,
    @Body('raw') raw: string,
  ) {
    if (typeof raw !== 'string' || raw.length === 0) {
      throw new BadRequestException('raw CSV 内容不能为空');
    }
    return this.service.importCsv(this.tenantOf(cur), id, raw);
  }

  @Post(':id/members/pick-contacts')
  pickContacts(
    @CurrentUser() cur: RequestUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: PickContactsDto,
  ) {
    return this.service.pickContacts(this.tenantOf(cur), id, dto);
  }

  @Delete(':id/members/:memberId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeMember(
    @CurrentUser() cur: RequestUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('memberId', ParseIntPipe) memberId: number,
  ) {
    await this.service.removeMember(this.tenantOf(cur), id, memberId);
  }

  // 2026-04-24 · 人工改坏号状态 (解禁 · 标 opt-out 等)
  @Patch(':id/members/:memberId/status')
  async setMemberStatus(
    @CurrentUser() cur: RequestUser,
    @Param('id', ParseIntPipe) _gid: number,
    @Param('memberId', ParseIntPipe) memberId: number,
    @Body('status', ParseIntPipe) status: number,
  ) {
    if (![0, 1, 2, 3].includes(status)) {
      throw new BadRequestException('status 必须是 0/1/2/3');
    }
    await this.service.setMemberStatus(this.tenantOf(cur), memberId, status);
    return { ok: true };
  }

  @Delete(':id/members')
  async clearMembers(
    @CurrentUser() cur: RequestUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const affected = await this.service.clearMembers(this.tenantOf(cur), id);
    return { removed: affected };
  }
}
