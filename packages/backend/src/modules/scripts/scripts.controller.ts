import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { PackLoaderService } from './pack-loader.service';
import { CurrentUser, type RequestUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserRole } from '../users/user.entity';
import * as path from 'node:path';

@Controller({ path: 'script-packs', version: '1' })
@UseGuards(RolesGuard)
@Roles(UserRole.Admin)
export class ScriptsController {
  constructor(private readonly loader: PackLoaderService) {}

  @Get()
  async list() {
    return this.loader.listPacks();
  }

  @Get(':id/scripts')
  async scripts(@Param('id', ParseIntPipe) id: number) {
    return this.loader.listScripts(id);
  }

  // dev 用: 从仓库默认 scripts/ 目录批量导入官方包
  @Post('import-bundled')
  async importBundled(@CurrentUser() cur: RequestUser) {
    if (cur.tenantId !== null) {
      throw new ForbiddenException('只有平台超管可以导入官方 bundled 剧本包');
    }
    // scripts/ 位于仓库根, backend cwd 是 packages/backend, 上两级
    const dir = path.resolve(process.cwd(), '..', '..', 'scripts');
    return this.loader.importFromDirectory(dir);
  }

  @Post('import')
  async importJson(@CurrentUser() cur: RequestUser, @Body() body: { packJson: unknown }) {
    if (cur.tenantId !== null) {
      throw new ForbiddenException('只有平台超管可以导入剧本包');
    }
    if (!body?.packJson || typeof body.packJson !== 'object') {
      throw new BadRequestException('packJson 必须是有效的 pack JSON 对象');
    }
    return this.loader.importJson(body.packJson as never);
  }

  @Patch(':id/toggle')
  @HttpCode(HttpStatus.OK)
  async toggle(
    @CurrentUser() cur: RequestUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { enabled: boolean },
  ) {
    if (cur.tenantId !== null) {
      throw new ForbiddenException('只有平台超管可以启停剧本包');
    }
    return this.loader.togglePack(id, !!body.enabled);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() cur: RequestUser, @Param('id', ParseIntPipe) id: number) {
    if (cur.tenantId !== null) {
      throw new ForbiddenException('只有平台超管可以删除剧本包');
    }
    await this.loader.removePack(id);
  }
}
