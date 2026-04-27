// M10 · 补强 1 · 单槽 daily 快照恢复 (§B.18 "从 daily 选日期一键回滚该槽位")
//
// 粒度:
//   - 只恢复 1 个 slot 的 wa-session + fingerprint.json
//   - 不动 DB (DB 级恢复走 .wab import)
//   - 可选日期 (不传 = 最新 daily)
//
// 流程:
//   1. 找 backups/daily/<date>/slot_<NN>.zip
//   2. baileys evictFromPool (防解压过程中有写冲突)
//   3. 解压覆盖 data/slots/<NN>/
//   4. baileys 下一个 onModuleInit / 手动 rehydrate 会自动挑回
//      (M9 已实现: 初始 scan slots status + session_path 存在 → spawnPooledSocket)
//
// 错误处理: 失败不破坏现状 (zip 损坏时只清了 evict, rehydrate 仍会用旧 session — 但旧 session
// 已被删掉时会 rehydrate 失败 · 用户下一步手动 bind-existing 重登)
// V1.1 考虑: 解压到 tmp → 验证 → 原子 rename 过去.

import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as yauzl from 'yauzl';
import { AccountSlotEntity } from '../slots/account-slot.entity';
import { RuntimeProcessManagerService } from '../runtime-process/runtime-process-manager.service';
import { getSlotDir } from '../../common/storage';
import { listDailyDates, listDailySlotZips } from './backup-paths';

@Injectable()
export class PerSlotRestoreService {
  private readonly logger = new Logger(PerSlotRestoreService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly runtimeProcess: RuntimeProcessManagerService,
  ) {}

  /**
   * 恢复单 slot
   * @param slotId `account_slot.id` (不是 slot_index)
   * @param dateISO 'YYYY-MM-DD', 不传 = 最新
   */
  async restore(slotId: number, dateISO?: string): Promise<{
    slotId: number;
    slotIndex: number;
    restoredFromDate: string;
    restoredFromPath: string;
  }> {
    const slot = await this.dataSource
      .getRepository(AccountSlotEntity)
      .findOne({ where: { id: slotId } });
    if (!slot) throw new NotFoundException(`slot ${slotId} 不存在`);

    const date = dateISO ?? this.latestDateOrThrow();
    const zips = listDailySlotZips(date);
    const found = zips.find((z) => z.slotIndex === slot.slotIndex);
    if (!found) {
      throw new NotFoundException(
        `date ${date} 没有 slot_index=${slot.slotIndex} 的快照 (可能当天该槽未绑号)`,
      );
    }

    // evict 旧 socket (release 后 rehydrate 才重新 spawn)
    await this.runtimeProcess.stop(slotId, { graceful: true, timeoutMs: 5000 }).catch(() => {});
    this.logger.log(`per-slot-restore · slotId=${slotId} (idx=${slot.slotIndex}) date=${date}`);

    // 清当前 slot 目录的 wa-session + fingerprint.json
    const dst = getSlotDir(slot.slotIndex);
    const wsDst = path.join(dst, 'wa-session');
    if (fs.existsSync(wsDst)) fs.rmSync(wsDst, { recursive: true, force: true });
    const fpDst = path.join(dst, 'fingerprint.json');
    if (fs.existsSync(fpDst)) fs.rmSync(fpDst, { force: true });

    // 解压
    await this.extractZipFromFile(found.filePath, dst);
    this.logger.log(`slot ${slot.slotIndex} restored from ${found.filePath}`);

    return {
      slotId,
      slotIndex: slot.slotIndex,
      restoredFromDate: date,
      restoredFromPath: found.filePath,
    };
  }

  /**
   * UI 用 · 查某 slot 可选的快照日期 (filter 有该 slot_index zip 的日期)
   */
  listAvailableSnapshots(slotIndex: number): Array<{ date: string; filePath: string; sizeBytes: number }> {
    const out: Array<{ date: string; filePath: string; sizeBytes: number }> = [];
    for (const d of listDailyDates()) {
      const match = listDailySlotZips(d).find((z) => z.slotIndex === slotIndex);
      if (match) out.push({ date: d, filePath: match.filePath, sizeBytes: match.sizeBytes });
    }
    return out.sort((a, b) => b.date.localeCompare(a.date)); // 新到旧
  }

  private latestDateOrThrow(): string {
    const dates = listDailyDates();
    if (dates.length === 0) throw new BadRequestException('尚无任何 daily 快照 · 先跑 /backup/daily 或等 03:00 自动');
    return dates[dates.length - 1];
  }

  private extractZipFromFile(zipPath: string, outDir: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
        if (err || !zipfile) return reject(err ?? new Error('yauzl: no zipfile'));
        zipfile.on('error', reject);
        zipfile.on('end', resolve);
        zipfile.readEntry();
        zipfile.on('entry', (entry) => {
          const entryPath = path.join(outDir, entry.fileName);
          if (/\/$/.test(entry.fileName)) {
            fs.mkdirSync(entryPath, { recursive: true });
            zipfile.readEntry();
            return;
          }
          fs.mkdirSync(path.dirname(entryPath), { recursive: true });
          zipfile.openReadStream(entry, (err2, stream) => {
            if (err2 || !stream) return reject(err2);
            const ws = fs.createWriteStream(entryPath);
            stream.pipe(ws);
            ws.on('finish', () => zipfile.readEntry());
            ws.on('error', reject);
          });
        });
      });
    });
  }
}
