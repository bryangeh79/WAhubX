import * as crypto from 'node:crypto';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ScriptEntity } from './script.entity';
import { RewriteCacheEntity } from './rewrite-cache.entity';
import { AssetEntity } from './asset.entity';
import { BaileysService } from '../baileys/baileys.service';
import { AccountSlotEntity } from '../slots/account-slot.entity';
import { WaAccountEntity } from '../slots/wa-account.entity';

// 剧本 JSON 的最小运行时结构 (从 ScriptEntity.content 解析)
interface SessionJson {
  name: string;
  delay_from_start?: string;
  turns: TurnJson[];
}

interface TurnJson {
  turn: number;
  role: 'A' | 'B';
  type: 'text' | 'voice' | 'image' | 'file';
  content_pool?: string[];
  asset_pool?: string;
  caption_fallback?: string;
  on_disabled?: 'skip' | 'send_fallback_text';
  typing_delay_ms?: [number, number];
  send_delay_sec?: [number, number];
  duration_sec_range?: [number, number];
}

export interface ScriptRunParams {
  scriptId: number;           // DB id (not script_id string)
  roleAaccountId: number;
  roleBaccountId: number;
  sessionIndex?: number;      // 默认跑第一个 session
  // dev/smoke 加速: 跳过 typing 和 send 延迟 (生产永不开)
  fastMode?: boolean;
}

export interface ScriptRunResult {
  turnsExecuted: number;
  turnsSkipped: number;
  errors: Array<{ turn: number; error: string }>;
}

@Injectable()
export class ScriptRunnerService {
  private readonly logger = new Logger(ScriptRunnerService.name);

  constructor(
    @InjectRepository(ScriptEntity) private readonly scriptRepo: Repository<ScriptEntity>,
    @InjectRepository(RewriteCacheEntity) private readonly cacheRepo: Repository<RewriteCacheEntity>,
    @InjectRepository(AssetEntity) private readonly assetRepo: Repository<AssetEntity>,
    @InjectRepository(AccountSlotEntity) private readonly slotRepo: Repository<AccountSlotEntity>,
    @InjectRepository(WaAccountEntity) private readonly accountRepo: Repository<WaAccountEntity>,
    private readonly baileys: BaileysService,
  ) {}

  async run(params: ScriptRunParams): Promise<ScriptRunResult> {
    const script = await this.scriptRepo.findOne({ where: { id: params.scriptId }, relations: ['pack'] });
    if (!script) throw new NotFoundException(`剧本 ${params.scriptId} 不存在`);
    if (!script.pack.enabled) throw new Error(`剧本包 ${script.pack.packId} 已禁用`);

    const sessions = (script.content.sessions ?? []) as SessionJson[];
    if (sessions.length === 0) throw new Error(`剧本 ${script.scriptId} 无 sessions`);
    const session = sessions[params.sessionIndex ?? 0];
    if (!session) throw new Error(`session index ${params.sessionIndex} 越界`);

    // 预取两账号手机号 → JID
    const [accA, accB] = await Promise.all([
      this.accountRepo.findOne({ where: { id: params.roleAaccountId } }),
      this.accountRepo.findOne({ where: { id: params.roleBaccountId } }),
    ]);
    if (!accA || !accB) throw new NotFoundException('A/B 账号不存在');

    // M5 gate: 双方 warmup_stage 必须 >= script.min_warmup_stage
    // 用户 2026-04-20 定: "gate 真开启, 不允许再临时关闭"
    const minStage = script.minWarmupStage ?? 0;
    if (accA.warmupStage < minStage || accB.warmupStage < minStage) {
      throw new Error(
        `warmup_stage 不足: script=${script.scriptId} 要求 ≥ ${minStage}, A=${accA.warmupStage} B=${accB.warmupStage}`,
      );
    }

    const result: ScriptRunResult = { turnsExecuted: 0, turnsSkipped: 0, errors: [] };

    for (const turn of session.turns) {
      try {
        const executed = await this.runTurn(script, turn, {
          accA,
          accB,
          roleAaccountId: params.roleAaccountId,
          roleBaccountId: params.roleBaccountId,
          fastMode: !!params.fastMode,
        });
        if (executed) result.turnsExecuted++;
        else result.turnsSkipped++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`script ${script.scriptId} turn ${turn.turn} failed: ${msg}`);
        result.errors.push({ turn: turn.turn, error: msg });
        // 单 turn 失败不中断整个 session — 记录后继续
      }
    }

    return result;
  }

  private async runTurn(
    script: ScriptEntity,
    turn: TurnJson,
    ctx: {
      accA: WaAccountEntity;
      accB: WaAccountEntity;
      roleAaccountId: number;
      roleBaccountId: number;
      fastMode: boolean;
    },
  ): Promise<boolean> {
    // 决定发送者/接收者
    const senderId = turn.role === 'A' ? ctx.roleAaccountId : ctx.roleBaccountId;
    const recipient = turn.role === 'A' ? ctx.accB.phoneNumber : ctx.accA.phoneNumber;
    if (!recipient) throw new Error(`接收方 ${turn.role === 'A' ? 'B' : 'A'} 无 phoneNumber`);

    const senderSlot = await this.slotRepo.findOne({ where: { accountId: senderId } });
    if (!senderSlot) throw new Error(`发送方 slot 不存在 (account ${senderId})`);

    // typing_delay (发之前等) — 生产必开, dev fastMode 下跳过
    if (!ctx.fastMode && turn.typing_delay_ms) {
      const [lo, hi] = turn.typing_delay_ms;
      await this.sleep(this.randomInt(lo, hi));
    }

    // 根据 type 分派
    if (turn.type === 'text') {
      const text = await this.resolveText(script.id, senderId, turn);
      if (!text) {
        this.logger.warn(`script ${script.scriptId} turn ${turn.turn} text 无可用内容, skip`);
        return false;
      }
      // 经 slot 发
      await this.baileys.sendText(senderSlot.id, recipient, text);
    } else if (turn.type === 'voice' || turn.type === 'image' || turn.type === 'file') {
      const asset = await this.pickAsset(turn.asset_pool);
      if (!asset) {
        // 无资源 — 按 on_disabled 策略降级
        if (turn.on_disabled === 'skip') {
          this.logger.warn(`script ${script.scriptId} turn ${turn.turn} 无资源 + on_disabled=skip, 跳过`);
          return false;
        }
        // 默认 send_fallback_text
        const fallback = turn.caption_fallback;
        if (!fallback) {
          this.logger.warn(`script ${script.scriptId} turn ${turn.turn} 无资源又无 caption_fallback, skip`);
          return false;
        }
        await this.baileys.sendText(senderSlot.id, recipient, fallback);
      } else {
        // 真有资源时走 sendMedia (M4 scope: 代码路径通, asset 表暂无数据 → 基本走 fallback)
        // M7 asset-studio 真填进表后, 这里会 readFileSync(asset.filePath) → base64 → sendMedia
        this.logger.warn(`script ${script.scriptId} turn ${turn.turn} 资源路径暂未实装, 走 fallback`);
        if (turn.caption_fallback) {
          await this.baileys.sendText(senderSlot.id, recipient, turn.caption_fallback);
        } else {
          return false;
        }
      }
    }

    // send_delay (发完后等到下一 turn)
    if (!ctx.fastMode && turn.send_delay_sec) {
      const [lo, hi] = turn.send_delay_sec;
      await this.sleep(this.randomInt(lo, hi) * 1000);
    }

    return true;
  }

  /**
   * 拿文本: AI rewrite cache → 命中复用; miss → content_pool 随机抽 + 写 cache.
   * M6 真 AI 上线后, cache miss 会触发生成而不是随机抽.
   */
  private async resolveText(scriptDbId: number, senderAccountId: number, turn: TurnJson): Promise<string | null> {
    if (!turn.content_pool || turn.content_pool.length === 0) return null;

    const personaHash = this.personaHash(senderAccountId, scriptDbId, turn.turn);
    const hit = await this.cacheRepo.findOne({
      where: { scriptId: scriptDbId, turnIndex: turn.turn, personaHash },
    });
    if (hit) {
      hit.usedCount += 1;
      await this.cacheRepo.save(hit);
      return hit.variantText;
    }

    // miss: M4 stub — 从 content_pool 随机抽 (不改写)
    const picked = turn.content_pool[this.randomInt(0, turn.content_pool.length - 1)];
    await this.cacheRepo.save(
      this.cacheRepo.create({
        scriptId: scriptDbId,
        turnIndex: turn.turn,
        personaHash,
        variantText: picked,
        usedCount: 1,
        source: 'm4_pool_pick',
      }),
    );
    return picked;
  }

  private async pickAsset(poolName: string | undefined) {
    if (!poolName) return null;
    const candidates = await this.assetRepo.find({ where: { poolName }, take: 20 });
    if (candidates.length === 0) return null;
    return candidates[this.randomInt(0, candidates.length - 1)];
  }

  private personaHash(accountId: number, scriptDbId: number, turnIndex: number): string {
    return crypto
      .createHash('sha1')
      .update(`${accountId}|${scriptDbId}|${turnIndex}`)
      .digest('hex')
      .substring(0, 16);
  }

  private randomInt(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
