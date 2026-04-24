import {
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
} from '@nestjs/common';
import { AiProvidersService, type CreateProviderDto, type UpdateProviderDto } from './ai-providers.service';
import { AiTextService } from './ai-text.service';
import { AiSettingsService } from './ai-settings.service';
import { CurrentUser, type RequestUser } from '../auth/decorators/current-user.decorator';

// §4.9 AI & 配置
//   GET    /ai-providers                                本地桌面应用单租户 · 任何租户 admin 可配
//   POST   /ai-providers
//   PATCH  /ai-providers/:id
//   DELETE /ai-providers/:id
//   POST   /ai-providers/:id/test   连通性测试
//   GET    /ai-settings
//   POST   /ai-settings/text-enable   { enabled: boolean }
//
// 2026-04-24 · 放开权限: 从"仅平台超管"改为"任何 admin 角色"
// 理由: V1 = 本地桌面应用 · 每台机器一个租户 · 租户 admin = 实际用户 · 应自主管理 AI key
@Controller({ path: 'ai-providers', version: '1' })
export class AiProvidersController {
  constructor(
    private readonly providers: AiProvidersService,
    private readonly text: AiTextService,
  ) {}

  private ensureAdmin(cur: RequestUser) {
    if (cur.role !== 'admin') {
      throw new ForbiddenException('仅 admin 角色可修改 AI provider 配置');
    }
  }

  @Get()
  async list(@CurrentUser() cur: RequestUser) {
    this.ensureAdmin(cur);
    return this.providers.list();
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@CurrentUser() cur: RequestUser, @Body() dto: CreateProviderDto) {
    this.ensureAdmin(cur);
    return this.providers.create(dto);
  }

  @Patch(':id')
  async update(
    @CurrentUser() cur: RequestUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateProviderDto,
  ) {
    this.ensureAdmin(cur);
    return this.providers.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() cur: RequestUser, @Param('id', ParseIntPipe) id: number) {
    this.ensureAdmin(cur);
    await this.providers.remove(id);
  }

  @Post(':id/test')
  @HttpCode(HttpStatus.OK)
  async test(@CurrentUser() cur: RequestUser, @Param('id', ParseIntPipe) id: number) {
    this.ensureAdmin(cur);
    const result = await this.text.test(id);
    return {
      ok: result.ok,
      latencyMs: result.latencyMs,
      providerUsed: result.providerUsed,
      ...(result.ok ? { modelUsed: result.modelUsed } : { error: result.error, message: result.message }),
    };
  }
}

@Controller({ path: 'ai-settings', version: '1' })
export class AiSettingsController {
  constructor(private readonly settings: AiSettingsService) {}

  private ensureAdmin(cur: RequestUser) {
    if (cur.role !== 'admin') {
      throw new ForbiddenException('仅 admin 角色可配置 AI 全局开关');
    }
  }

  @Get()
  async get(@CurrentUser() cur: RequestUser) {
    this.ensureAdmin(cur);
    return this.settings.snapshot();
  }

  @Post('text-enable')
  @HttpCode(HttpStatus.OK)
  async setTextEnabled(
    @CurrentUser() cur: RequestUser,
    @Body() body: { enabled: boolean },
  ) {
    this.ensureAdmin(cur);
    const enabled = await this.settings.setTextEnabled(!!body.enabled);
    return { text_enabled: enabled };
  }

  // 2026-04-24 · 营销人设 (广告/开场白 AI 用)
  @Post('marketing-prompt')
  @HttpCode(HttpStatus.OK)
  async setMarketingPrompt(
    @CurrentUser() cur: RequestUser,
    @Body() body: { prompt: string },
  ) {
    this.ensureAdmin(cur);
    if (typeof body.prompt !== 'string') {
      throw new ForbiddenException('prompt 必须是字符串');
    }
    const saved = await this.settings.setMarketingPrompt(body.prompt);
    return { marketing_system_prompt: saved };
  }

  @Post('marketing-prompt/reset')
  @HttpCode(HttpStatus.OK)
  async resetMarketingPrompt(@CurrentUser() cur: RequestUser) {
    this.ensureAdmin(cur);
    const def = await this.settings.resetMarketingPrompt();
    return { marketing_system_prompt: def };
  }
}
