// 2026-04-29 · AI 智能客服 dry-run debug controller
//
// 仅 dev / admin 可用. 通过 env ENABLE_AI_DEBUG_ENDPOINT=true 才挂.
// POST /api/v1/intelligent-reply/debug/dry-run
//
// 用途: 模拟客户消息跑完整 reply-executor 链路, 不真发 WhatsApp, audit draft=true.

import {
  BadRequestException,
  Body,
  Controller,
  Logger,
  Post,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ReplyDebugService,
  type DryRunInput,
  type DryRunResult,
} from '../services/reply-debug.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser, type RequestUser } from '../../auth/decorators/current-user.decorator';
import { UserRole } from '../../users/user.entity';

@Controller({ path: 'intelligent-reply/debug', version: '1' })
@UseGuards(JwtAuthGuard)
export class ReplyDebugController {
  private readonly logger = new Logger(ReplyDebugController.name);

  constructor(
    private readonly debug: ReplyDebugService,
    private readonly config: ConfigService,
  ) {}

  /**
   * POST /api/v1/intelligent-reply/debug/dry-run
   *
   * Body:
   *   {
   *     tenantId: 99,
   *     message: "我想了解祛痘",
   *     phoneE164?: "60123456789",   // 可选 · 默认临时 phone
   *     mode?: "smart" | "faq" | "off",  // 可选 · 不传走 tenant settings
   *     kbId?: 202,                  // 可选 · 强制绑产品 KB
   *     forceStage?: "new" | ...,    // 可选 · 强制 conv stage
   *     reuseRealConversation?: false, // 默认 false (建临时 conv)
   *     send?: false                 // 默认 false · true 不被允许
   *   }
   *
   * Response: DryRunResult (含完整决策路径 + audit id + KB pool)
   */
  @Post('dry-run')
  async dryRun(
    @Body() body: DryRunInput,
    @CurrentUser() user: RequestUser,
  ): Promise<DryRunResult> {
    // env 守卫
    const enabled = this.config.get<string>('ENABLE_AI_DEBUG_ENDPOINT', 'false');
    if (enabled !== 'true' && enabled !== '1') {
      throw new UnauthorizedException(
        'AI debug endpoint disabled · set ENABLE_AI_DEBUG_ENDPOINT=true',
      );
    }
    // 角色守卫 · 必须 admin
    if (user.role !== UserRole.Admin) {
      throw new UnauthorizedException('only admin can use dry-run debug');
    }
    // 防注: send=true 不允许
    if (body.send === true) {
      throw new BadRequestException('send=true 不允许 · dry-run 仅模拟, 不真发');
    }
    this.logger.log(
      `dry-run req · admin=${user.email ?? user.id} · tenant=${body.tenantId} · mode=${body.mode ?? '(default)'} · message="${(body.message ?? '').slice(0, 40)}"`,
    );
    return this.debug.dryRun({ ...body, send: false });
  }
}
