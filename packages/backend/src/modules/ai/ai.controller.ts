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
//   GET    /ai-providers                                全局一份 (§6 单租户假设), 只 platform admin 可改
//   POST   /ai-providers
//   PATCH  /ai-providers/:id
//   DELETE /ai-providers/:id
//   POST   /ai-providers/:id/test   连通性测试
//   GET    /ai-settings
//   POST   /ai-settings/text-enable   { enabled: boolean }
@Controller({ path: 'ai-providers', version: '1' })
export class AiProvidersController {
  constructor(
    private readonly providers: AiProvidersService,
    private readonly text: AiTextService,
  ) {}

  private ensurePlatformAdmin(cur: RequestUser) {
    if (cur.tenantId !== null) {
      throw new ForbiddenException('仅平台超管可修改 AI provider 配置 (§6 单租户假设)');
    }
  }

  @Get()
  async list(@CurrentUser() cur: RequestUser) {
    this.ensurePlatformAdmin(cur);
    return this.providers.list();
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@CurrentUser() cur: RequestUser, @Body() dto: CreateProviderDto) {
    this.ensurePlatformAdmin(cur);
    return this.providers.create(dto);
  }

  @Patch(':id')
  async update(
    @CurrentUser() cur: RequestUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateProviderDto,
  ) {
    this.ensurePlatformAdmin(cur);
    return this.providers.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() cur: RequestUser, @Param('id', ParseIntPipe) id: number) {
    this.ensurePlatformAdmin(cur);
    await this.providers.remove(id);
  }

  @Post(':id/test')
  @HttpCode(HttpStatus.OK)
  async test(@CurrentUser() cur: RequestUser, @Param('id', ParseIntPipe) id: number) {
    this.ensurePlatformAdmin(cur);
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

  @Get()
  async get(@CurrentUser() cur: RequestUser) {
    if (cur.tenantId !== null) {
      throw new ForbiddenException('仅平台超管可查看 AI 全局设置');
    }
    return this.settings.snapshot();
  }

  @Post('text-enable')
  @HttpCode(HttpStatus.OK)
  async setTextEnabled(
    @CurrentUser() cur: RequestUser,
    @Body() body: { enabled: boolean },
  ) {
    if (cur.tenantId !== null) {
      throw new ForbiddenException('仅平台超管可切换 AI 全局开关');
    }
    const enabled = await this.settings.setTextEnabled(!!body.enabled);
    return { text_enabled: enabled };
  }
}
