import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { TaskExecutor, TaskExecutorContext, TaskExecutorResult } from '../tasks/executor.interface';
import { AssetEntity, AssetKind } from '../scripts/asset.entity';
import { ScriptEntity } from '../scripts/script.entity';
import { AccountSlotEntity } from '../slots/account-slot.entity';
import { BaileysService } from '../baileys/baileys.service';
import { WarmupPlanEntity, WarmupPhase } from './warmup-plan.entity';

// status_post 执行器 · §B.20 4 层素材降级
// Phase gate (executor 内再 double check, calendar 已过过一次):
//   Phase 0-1: 禁止 · return skip
//   Phase 2+: 允许
// 素材消费链 (硬编码 1→2→3→4 不允许跳层):
//   1. persona.custom_pool (M7+ AI 生成的账号专属图)
//   2. _builtin_* 兜底素材 (§B.16, M5 期间空, M7 填)
//   3. script_pack status_posts 类别纯文本
//   4. skip (新号发纯文本 Status 比图文更可疑, 宁可空过)
@Injectable()
export class StatusPostExecutor implements TaskExecutor {
  readonly taskType = 'status_post';
  readonly allowedInNightWindow = false;
  private readonly logger = new Logger(StatusPostExecutor.name);

  constructor(
    private readonly baileys: BaileysService,
    @InjectRepository(AssetEntity) private readonly assetRepo: Repository<AssetEntity>,
    @InjectRepository(ScriptEntity) private readonly scriptRepo: Repository<ScriptEntity>,
    @InjectRepository(AccountSlotEntity) private readonly slotRepo: Repository<AccountSlotEntity>,
    @InjectRepository(WarmupPlanEntity) private readonly planRepo: Repository<WarmupPlanEntity>,
  ) {}

  async execute(ctx: TaskExecutorContext): Promise<TaskExecutorResult> {
    const plan = await this.planRepo.findOne({ where: { accountId: ctx.accountId } });
    if (!plan) {
      return { success: false, errorCode: 'NO_PLAN', errorMessage: `account ${ctx.accountId} 无 warmup_plan` };
    }
    if (plan.currentPhase < WarmupPhase.Activate) {
      ctx.log('phase-gate-block', false, { phase: plan.currentPhase });
      return {
        success: false,
        errorCode: 'PHASE_GATE',
        errorMessage: `status_post 需 Phase ≥ 2, 当前 Phase ${plan.currentPhase}`,
      };
    }

    const slot = await this.slotRepo.findOne({
      where: { accountId: ctx.accountId },
      relations: ['account'],
    });
    if (!slot) return { success: false, errorCode: 'NO_SLOT', errorMessage: `account ${ctx.accountId} 无 slot` };

    // 层 1: persona custom pool (M5 暂无, M7 填)
    const persona = (slot.persona ?? {}) as { statusPool?: string };
    if (persona.statusPool) {
      const asset = await this.pickAsset(persona.statusPool, AssetKind.Image);
      if (asset) {
        ctx.log('layer1-persona-pool-hit', true, { poolName: persona.statusPool });
        // 真发图待 M7 素材到位. 当前代码路径通, 降到文字.
        this.logger.warn('layer1 命中但 M5 未实装 image status, 降 fallback caption');
      }
    }

    // 层 2: _builtin_* 兜底 (M5 期间空)
    const builtinAsset = await this.pickAsset('_builtin_images_life', AssetKind.Image);
    if (builtinAsset) {
      ctx.log('layer2-builtin-hit', true, { assetId: builtinAsset.id });
      this.logger.warn('layer2 命中但 M5 未实装 image status, 降 fallback caption');
    }

    // 层 3: script_pack status_posts 纯文本
    const text = await this.pickStatusPostText();
    if (text) {
      try {
        const res = await this.baileys.sendStatusText(slot.id, text);
        ctx.log('layer3-text-sent', true, { len: text.length, waMessageId: res.waMessageId });
        return { success: true };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        ctx.log('layer3-send-failed', false, { error: msg });
        return { success: false, errorCode: 'SEND_FAILED', errorMessage: msg };
      }
    }

    // 层 4: skip
    ctx.log('layer4-skip', false, { reason: '4 层降级全空' });
    return { success: true }; // 不视为失败, calendar 空过
  }

  private async pickAsset(poolName: string, kind: AssetKind) {
    const candidates = await this.assetRepo.find({ where: { poolName, kind }, take: 20 });
    if (candidates.length === 0) return null;
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  /**
   * 从所有 enabled pack 的 status_posts 类别剧本里抽文案.
   * content.status_texts 存字符串数组; 没有则回 null.
   */
  private async pickStatusPostText(): Promise<string | null> {
    const scripts = await this.scriptRepo
      .createQueryBuilder('s')
      .where('s.category = :cat', { cat: 'status_posts' })
      .andWhere('s.pack_id IN (SELECT id FROM script_pack WHERE enabled = true)')
      .getMany();
    const pool: string[] = [];
    for (const s of scripts) {
      const texts = (s.content?.status_texts ?? []) as string[];
      if (Array.isArray(texts)) pool.push(...texts.filter((t) => typeof t === 'string'));
    }
    if (pool.length === 0) return null;
    return pool[Math.floor(Math.random() * pool.length)];
  }
}
