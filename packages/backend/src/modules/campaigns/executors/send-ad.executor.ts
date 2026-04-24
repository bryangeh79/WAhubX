import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type {
  TaskExecutor,
  TaskExecutorContext,
  TaskExecutorResult,
} from '../../tasks/executor.interface';
import { BaileysService } from '../../baileys/baileys.service';
import { AccountSlotEntity } from '../../slots/account-slot.entity';
import { AdvertisementEntity } from '../entities/advertisement.entity';
import { OpeningLineEntity } from '../entities/opening-line.entity';
import {
  CampaignTargetEntity,
  CampaignTargetStatus,
} from '../entities/campaign-target.entity';
import { CampaignEntity, CampaignStatus } from '../entities/campaign.entity';
import { ThrottleProfileService } from '../services/throttle-profile.service';
import { AdvertisementsService } from '../services/advertisements.service';
import { OpeningLinesService } from '../services/opening-lines.service';
import { CustomerGroupsService } from '../services/customer-groups.service';
import { phoneToJid } from '../utils/phone';

// 2026-04-23 · 广告发送 executor · plan §B "Send-Ad Executor"
//
// task_type = 'send_ad'
// payload   = { campaignId, runId, campaignTargetId, phone, adId, openingId? }
// targetIds = [accountId]
//
// 流程:
//   1. feature flag 开? 否 skip
//   2. 查 target 仍为 Dispatched · 否则 skip (已取消)
//   3. 查 campaign 仍 Running · 否则 skip
//   4. 拼消息文本 (opening + \n + ad.content)
//   5. baileys.sendText (或 sendMedia 如果 ad.asset_id 不 null · V1.1 支持)
//   6. 更新 target.status=Sent · sent_at=now
//   7. 随机 sleep gap_sec[0]..gap_sec[1]

interface SendAdPayload {
  campaignId?: number;
  runId?: number;
  campaignTargetId?: number | string;
  phone?: string;
  adId?: number;
  openingId?: number | null;
}

@Injectable()
export class SendAdExecutor implements TaskExecutor {
  readonly taskType = 'send_ad';
  readonly allowedInNightWindow = false;

  private readonly logger = new Logger(SendAdExecutor.name);

  constructor(
    private readonly baileys: BaileysService,
    private readonly throttle: ThrottleProfileService,
    private readonly ads: AdvertisementsService,
    private readonly openings: OpeningLinesService,
    private readonly groups: CustomerGroupsService,
    @InjectRepository(AccountSlotEntity)
    private readonly slotRepo: Repository<AccountSlotEntity>,
    @InjectRepository(AdvertisementEntity)
    private readonly adRepo: Repository<AdvertisementEntity>,
    @InjectRepository(OpeningLineEntity)
    private readonly openingRepo: Repository<OpeningLineEntity>,
    @InjectRepository(CampaignTargetEntity)
    private readonly targetRepo: Repository<CampaignTargetEntity>,
    @InjectRepository(CampaignEntity)
    private readonly campaignRepo: Repository<CampaignEntity>,
  ) {}

  async execute(ctx: TaskExecutorContext): Promise<TaskExecutorResult> {
    const payload = (ctx.task.payload ?? {}) as SendAdPayload;

    // 1. feature flag
    const enabled = await this.throttle.isModuleEnabled();
    if (!enabled) {
      ctx.log('feature-disabled-skip', true);
      return { success: false, errorCode: 'MODULE_DISABLED', errorMessage: '广告模块已关闭' };
    }

    // 2. 查 target
    const targetId = payload.campaignTargetId;
    if (targetId === undefined || targetId === null) {
      return { success: false, errorCode: 'INVALID_PAYLOAD', errorMessage: 'campaignTargetId 缺失' };
    }
    const target = await this.targetRepo.findOne({
      where: { id: String(targetId) as unknown as string },
    });
    if (!target) {
      return { success: false, errorCode: 'TARGET_NOT_FOUND', errorMessage: `target ${targetId} 不存在` };
    }
    if (target.status !== CampaignTargetStatus.Dispatched) {
      ctx.log('target-not-dispatched-skip', true, { status: target.status });
      return { success: false, errorCode: 'TARGET_STATE', errorMessage: `target status=${target.status}` };
    }

    // 3. 查 campaign
    const campaign = await this.campaignRepo.findOne({ where: { id: target.campaignId } });
    if (!campaign) {
      return this.markFail(target, 'CAMPAIGN_NOT_FOUND', '投放任务不存在');
    }
    if (campaign.status !== CampaignStatus.Running) {
      await this.markTarget(target, CampaignTargetStatus.Skipped, 'CAMPAIGN_NOT_RUNNING', `status=${campaign.status}`);
      ctx.log('campaign-not-running-skip', true, { status: campaign.status });
      return { success: false, errorCode: 'CAMPAIGN_NOT_RUNNING', errorMessage: `campaign status=${campaign.status}` };
    }

    // 4. 查 slot · 确认 accountId 匹配
    const slot = await this.slotRepo.findOne({ where: { accountId: ctx.accountId } });
    if (!slot) {
      return this.markFail(target, 'SLOT_NOT_FOUND', `account ${ctx.accountId} 无槽位`);
    }

    // 5. 拼文本 · 广告本身 → 若 ai_enabled + variants 非空, 随机抽 1 条变体 · 否则用原文
    const ad = target.adId ? await this.adRepo.findOne({ where: { id: target.adId } }) : null;
    if (!ad) {
      return this.markFail(target, 'AD_MISSING', `广告 ${target.adId} 不存在`);
    }
    const adBody = this.ads.pickRandomContent(ad);
    let openingContent = '';
    if (target.openingId) {
      const openingRow = await this.openingRepo.findOne({ where: { id: target.openingId } });
      if (openingRow) {
        // 开场白也走变体池抽随机 · AI 开启时每次不同 · 关闭时用原文
        openingContent = this.openings.pickRandomContent(openingRow);
      }
    }
    const body = this.composeMessage(openingContent, adBody);

    ctx.throwIfPaused?.();
    ctx.log('send-ad-prepared', true, { phone: target.phoneE164, adId: target.adId });

    // 6. 发
    const jid = phoneToJid(target.phoneE164);
    try {
      await this.baileys.sendText(slot.id, jid, body);
      ctx.throwIfPaused?.();

      await this.markTarget(target, CampaignTargetStatus.Sent, null, null, new Date());
      ctx.log('send-ad-sent', true, { phone: target.phoneE164 });

      // 2026-04-24 · 成功回填 customer_group_member (重置 fail_count)
      await this.groups
        .recordMemberSendResult(campaign.tenantId, target.phoneE164, { ok: true })
        .catch((e) => this.logger.warn(`member feedback (ok) 失败: ${e}`));

      // 7. 随机 sleep gap (避免同 socket 连续发太快)
      const params = await this.throttle.get(campaign.throttleProfile);
      const [gMin, gMax] = params.gapSec;
      const gapMs = (gMin + (gMax - gMin) * Math.random()) * 1000;
      await new Promise((r) => setTimeout(r, gapMs));

      return { success: true };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`send-ad task ${ctx.task.id} target ${target.id} failed: ${msg}`);
      await this.markTarget(target, CampaignTargetStatus.Failed, 'SEND_FAILED', msg);

      // 2026-04-24 · 失败回填 member · 硬失败 (号不存在) 1 次直接拉黑
      await this.groups
        .recordMemberSendResult(campaign.tenantId, target.phoneE164, {
          ok: false,
          errorCode: 'SEND_FAILED',
          errorMsg: msg,
        })
        .catch((e) => this.logger.warn(`member feedback (fail) 失败: ${e}`));

      return { success: false, errorCode: 'SEND_FAILED', errorMessage: msg };
    }
  }

  private composeMessage(opening: string, ad: string): string {
    const op = (opening ?? '').trim();
    const body = (ad ?? '').trim();
    if (!op) return body;
    return `${op}\n\n${body}`;
  }

  private async markTarget(
    target: CampaignTargetEntity,
    status: CampaignTargetStatus,
    errorCode: string | null,
    errorMsg: string | null,
    sentAt: Date | null = null,
  ): Promise<void> {
    await this.targetRepo.update(target.id, {
      status,
      errorCode,
      errorMsg,
      sentAt: sentAt ?? target.sentAt,
    });
  }

  private async markFail(
    target: CampaignTargetEntity,
    code: string,
    msg: string,
  ): Promise<TaskExecutorResult> {
    await this.markTarget(target, CampaignTargetStatus.Failed, code, msg);
    return { success: false, errorCode: code, errorMessage: msg };
  }
}
