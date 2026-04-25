import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { jidToPhone } from '../utils/phone';

// 2026-04-24 · Z 方案 · 客户回复归因
//
// 监听 baileys 的 'takeover.message.in' 事件 (inbound 消息入库后广播)
// 查 "同 phone + 本租户 + 7 天内 Sent" 的 campaign_target, 标 replied_at + 递增 reply_count
// 只首次回复才标 replied_at, 后续回复只累加 reply_count

interface InboundEvent {
  accountId?: number;
  contactId?: number | null;
  messageId?: string;
  remoteJid?: string;
  direction?: string;
  msgType?: string;
  content?: string | null;
  mediaPath?: string | null;
  waMessageId?: string | null;
  sentAt?: string;
  manual?: boolean;
  // 2026-04-25 · D11-3 · slot 角色 · 仅 customer_service 号的 inbound 才算回复归因
  slotRole?: 'broadcast' | 'customer_service';
}

const ATTRIBUTION_WINDOW_DAYS = 7;

@Injectable()
export class ReplyAttributionService {
  private readonly logger = new Logger(ReplyAttributionService.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  @OnEvent('takeover.message.in')
  async onInbound(evt: InboundEvent): Promise<void> {
    try {
      if (!evt?.remoteJid || !evt.accountId) return;
      // 忽略群消息
      if (evt.remoteJid.includes('@g.us')) return;

      // 2026-04-25 · D11-3 · 角色路由门禁 (Codex 边界 ②)
      // 仅 customer_service 槽位的 inbound 才做回复归因
      // 业务逻辑: 客户回的是客服号 (广告里直接告知 contact 客服) · 不是回广告号
      // broadcast 号收到的 inbound 视为异常 / 误回 · log skip
      if (evt.slotRole !== 'customer_service') {
        this.logger.log(
          `reply-attribution gate · skip-role-mismatch · acc=${evt.accountId} · slotRole="${evt.slotRole ?? 'unset'}" · ` +
            `仅 customer_service 槽位做回复归因`,
        );
        return;
      }

      const phone = jidToPhone(evt.remoteJid);
      if (!phone) return;

      // 通过 account_id 反查 tenant_id (via account_slot)
      const slotRows = await this.dataSource.query<Array<{ tenant_id: number }>>(
        `SELECT tenant_id FROM account_slot WHERE account_id = $1 LIMIT 1`,
        [evt.accountId],
      );
      if (slotRows.length === 0) return;
      const tenantId = slotRows[0].tenant_id;

      // 找最近 7 天内 sent 且 phone 匹配的 target (同租户)
      // 多个 campaign 都发过 → 都标, 每个 campaign 算各自的回复
      const windowStart = new Date(Date.now() - ATTRIBUTION_WINDOW_DAYS * 86_400_000);
      const targetRows = await this.dataSource.query<Array<{
        id: string;
        campaign_id: number;
        replied_at: Date | null;
      }>>(
        `
        SELECT t.id, t.campaign_id, t.replied_at
        FROM campaign_target t
        INNER JOIN campaign c ON c.id = t.campaign_id
        WHERE c.tenant_id = $1
          AND t.phone_e164 = $2
          AND t.status = 2
          AND t.sent_at >= $3
        ORDER BY t.sent_at DESC
        `,
        [tenantId, phone, windowStart],
      );
      if (targetRows.length === 0) return;

      // 更新: 首次回复写 replied_at + count=1, 后续只 count++
      const nowIso = new Date();
      const neverReplied = targetRows.filter((r) => r.replied_at === null).map((r) => r.id);
      const alreadyReplied = targetRows.filter((r) => r.replied_at !== null).map((r) => r.id);

      if (neverReplied.length > 0) {
        await this.dataSource.query(
          `UPDATE campaign_target
           SET replied_at = $1, reply_count = reply_count + 1
           WHERE id = ANY($2::bigint[])`,
          [nowIso, neverReplied],
        );
        this.logger.log(
          `reply-attribution · tenant=${tenantId} phone=${phone} · 首次回复 ${neverReplied.length} 个 target`,
        );
      }
      if (alreadyReplied.length > 0) {
        await this.dataSource.query(
          `UPDATE campaign_target
           SET reply_count = reply_count + 1
           WHERE id = ANY($1::bigint[])`,
          [alreadyReplied],
        );
      }
    } catch (err) {
      // 不影响 takeover 广播主流程
      this.logger.warn(`reply attribution failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  /**
   * 给前端查: 某 phone 在该租户下是否关联 campaign (接管 UI 显示 "来自广告" Badge 用)
   * 返回命中的最近一个 target (用于 UI 提示)
   */
  async lookupByPhone(tenantId: number, phoneE164: string) {
    const rows = await this.dataSource.query<Array<{
      target_id: string;
      campaign_id: number;
      campaign_name: string;
      ad_id: number | null;
      ad_name: string | null;
      sent_at: Date;
      replied_at: Date | null;
      reply_count: number;
    }>>(
      `
      SELECT
        t.id as target_id,
        t.campaign_id,
        c.name as campaign_name,
        t.ad_id,
        a.name as ad_name,
        t.sent_at,
        t.replied_at,
        t.reply_count
      FROM campaign_target t
      INNER JOIN campaign c ON c.id = t.campaign_id
      LEFT JOIN advertisement a ON a.id = t.ad_id
      WHERE c.tenant_id = $1
        AND t.phone_e164 = $2
        AND t.status = 2
      ORDER BY t.sent_at DESC
      LIMIT 5
      `,
      [tenantId, phoneE164],
    );
    return rows.map((r) => ({
      targetId: r.target_id,
      campaignId: r.campaign_id,
      campaignName: r.campaign_name,
      adId: r.ad_id,
      adName: r.ad_name,
      sentAt: r.sent_at,
      repliedAt: r.replied_at,
      replyCount: r.reply_count,
    }));
  }
}
