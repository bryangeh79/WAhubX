// M10 · .wab 手动导入 · defense in depth (F+)
//
// 流程:
//   1. 解析 .wab header (不 decrypt) · 校验 magic + version + schema_hash
//   2. **F+ · 自动备份当前状态到 pre-import/<ts>.wab** (用当前 masterKey)
//   3. decrypt .wab → inner zip
//   4. 提取 db.sql + slots/
//   5. 用 docker psql 灌 db.sql (pg_dump --clean 已带 DROP TABLE IF EXISTS)
//   6. 覆盖 slots/ 目录内容 (先清 slot 下 wa-session + fingerprint.json, 不删 media · 用户数据)
//   7. baileys evictFromPool + 不重启服务 (用户 UI 上看 baileys status 自行重连)
//   8. 任一步失败 → 回滚: 用 pre-import backup 恢复 (递归 importFromWab)
//
// ⚠️ 关键假设:
//   - import 覆盖当前租户数据 · 不支持"合并" (V1.1 考虑)
//   - 若 .wab 来自不同机器 (machine fingerprint 不同), decrypt 会失败 → 走 E2 recovery

import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { exec } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { promisify } from 'node:util';
import * as yauzl from 'yauzl';
import { MASTER_KEY_PROVIDER, type MasterKeyProvider } from '../ai/master-key.provider';
import { getSlotDir } from '../../common/storage';
import { BaileysService } from '../baileys/baileys.service';
import { decodeWab, parseWabHeader, type WabManifest } from './wab-codec';
import { BackupExportService } from './backup-export.service';

const execAsync = promisify(exec);

export interface ImportPreview {
  manifest: WabManifest;
  fileBytes: number;
  // 当前 schema 与 backup schema 是否匹配
  schemaMatches: boolean;
  currentSchemaHash: string;
}

export interface ImportResult {
  ok: boolean;
  preImportBackupPath: string;
  restoredSlotIndexes: number[];
  elapsedMs: number;
}

@Injectable()
export class BackupImportService {
  private readonly logger = new Logger(BackupImportService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(MASTER_KEY_PROVIDER) private readonly masterKey: MasterKeyProvider,
    private readonly exportSvc: BackupExportService,
    private readonly baileys: BaileysService,
  ) {}

  /**
   * 仅 parse + compare schema · 不 decrypt · 不写任何东西
   */
  async preview(wab: Buffer): Promise<ImportPreview> {
    const header = parseWabHeader(wab);
    const currentHash = await this.computeCurrentSchemaHash();
    return {
      manifest: header.manifest,
      fileBytes: wab.length,
      schemaMatches: header.manifest.schema_hash === currentHash,
      currentSchemaHash: currentHash,
    };
  }

  /**
   * 执行导入 · F+ 先自动备份当前状态
   * 用户必须在 UI 上确认 overwrite · backend 这里只做流程
   */
  async import(wab: Buffer, options: { overrideKey?: Buffer } = {}): Promise<ImportResult> {
    const started = Date.now();

    // 0. preview 先行 · 校验格式
    const prev = await this.preview(wab);
    this.logger.log(
      `import begin · source=${prev.manifest.source} · created=${prev.manifest.created_at} · schemaMatch=${prev.schemaMatches}`,
    );

    // 1. F+ · pre-import 自动备份 (用当前 masterKey)
    const preImport = await this.exportSvc.export({
      source: 'pre-import',
      notes: `auto-before-import from ${prev.manifest.source} at ${prev.manifest.created_at}`,
    });
    this.logger.log(`pre-import backup saved · ${preImport.filePath}`);

    // 2. decrypt .wab
    let innerZip: Buffer;
    try {
      const decoded = decodeWab({ wab, key: options.overrideKey ?? this.masterKey.getKey() });
      innerZip = decoded.innerZip;
    } catch (err) {
      throw new BadRequestException(
        `WAB_DECRYPT_FAILED · ${err instanceof Error ? err.message : err}`,
      );
    }

    // 3. extract inner zip → temp dir
    const tmpDir = path.resolve(process.cwd(), 'data', 'tmp', `import-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    try {
      await this.extractZip(innerZip, tmpDir);
      const dumpPath = path.join(tmpDir, 'db.sql');
      if (!fs.existsSync(dumpPath)) throw new Error('inner zip 缺 db.sql');

      // 4. psql 灌数据 (pg_dump --clean 自带 DROP · 干净重建)
      await this.psqlRestore(dumpPath);
      this.logger.log(`db.sql restored`);

      // 5. 覆盖 slots 目录
      const restoredSlots = await this.restoreSlots(tmpDir);
      this.logger.log(`restored slots: [${restoredSlots.join(',')}]`);

      // 6. baileys evict all (本次导入大概率影响所有 slot · 让 listing 重跑 rehydrate)
      for (const idx of restoredSlots) {
        // account_slot 里用 slot.id · 这里 idx 是 slotIndex · evict 走 slot.id
        // 导入后 account_slot 表已被恢复, 需要重查
        const slot = await this.dataSource.query(
          'SELECT id FROM account_slot WHERE slot_index = $1 LIMIT 1',
          [idx],
        );
        if (slot?.[0]?.id) await this.baileys.evictFromPool(slot[0].id);
      }

      return {
        ok: true,
        preImportBackupPath: preImport.filePath,
        restoredSlotIndexes: restoredSlots,
        elapsedMs: Date.now() - started,
      };
    } catch (err) {
      this.logger.error(`import failed, attempting rollback: ${err}`);
      // 回滚: 用 pre-import backup 再走一次 (不递归 pre-import, override)
      try {
        const rollbackBuf = fs.readFileSync(preImport.filePath);
        await this.rollbackFromBuffer(rollbackBuf);
        this.logger.warn(`rollback ok · data 恢复到 import 前状态`);
      } catch (rollbackErr) {
        this.logger.error(
          `ROLLBACK FAILED · pre-import .wab 在 ${preImport.filePath} · 手动恢复`,
        );
        throw new Error(
          `import failed + rollback failed · pre-import backup at ${preImport.filePath} · 请联系技术支持手动恢复. 原错误: ${err instanceof Error ? err.message : err}`,
        );
      }
      throw err;
    } finally {
      // 清 tmp
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  }

  /**
   * 专门给回滚路径用 · 不再做 pre-import backup (防递归 + 用户数据已回滚)
   */
  private async rollbackFromBuffer(wab: Buffer): Promise<void> {
    const { innerZip } = decodeWab({ wab, key: this.masterKey.getKey() });
    const tmpDir = path.resolve(process.cwd(), 'data', 'tmp', `rollback-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    try {
      await this.extractZip(innerZip, tmpDir);
      await this.psqlRestore(path.join(tmpDir, 'db.sql'));
      await this.restoreSlots(tmpDir);
    } finally {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  }

  // ── 内部工具 ───────────────────────────────────────────
  private async psqlRestore(sqlFile: string): Promise<void> {
    const container = process.env.WAHUBX_PG_CONTAINER ?? 'wahubx-dev-pg';
    const user = process.env.WAHUBX_PG_USER ?? 'wahubx';
    const db = process.env.WAHUBX_PG_DB ?? 'wahubx';
    // 用 `docker cp` 拷文件进容器 + `psql -f` 重放 · stdin pipe 在 Windows shell 不稳
    const tmpInContainer = `/tmp/restore-${Date.now()}.sql`;
    await execAsync(`docker cp "${sqlFile}" ${container}:${tmpInContainer}`);
    try {
      const { stderr } = await execAsync(
        `docker exec ${container} psql -U ${user} -d ${db} -v ON_ERROR_STOP=1 -f ${tmpInContainer}`,
        { maxBuffer: 64 * 1024 * 1024 },
      );
      if (stderr && /ERROR/i.test(stderr)) {
        throw new Error(`psql restore errors: ${stderr.slice(0, 500)}`);
      }
    } finally {
      await execAsync(`docker exec ${container} rm -f ${tmpInContainer}`).catch(() => undefined);
    }
  }

  private async restoreSlots(innerDir: string): Promise<number[]> {
    const slotsDir = path.join(innerDir, 'slots');
    if (!fs.existsSync(slotsDir)) return [];
    const restored: number[] = [];
    for (const slotName of fs.readdirSync(slotsDir)) {
      const m = /^slot_(\d{2})$/.exec(slotName);
      if (!m) continue;
      const slotIndex = parseInt(m[1], 10);
      const src = path.join(slotsDir, slotName);
      const dst = getSlotDir(slotIndex);

      // 清 wa-session + fingerprint.json (不删 media · 用户数据保留)
      const wsDst = path.join(dst, 'wa-session');
      if (fs.existsSync(wsDst)) fs.rmSync(wsDst, { recursive: true, force: true });
      const fpDst = path.join(dst, 'fingerprint.json');
      if (fs.existsSync(fpDst)) fs.rmSync(fpDst, { force: true });

      // 复制
      const wsSrc = path.join(src, 'wa-session');
      if (fs.existsSync(wsSrc)) fs.cpSync(wsSrc, wsDst, { recursive: true });
      const fpSrc = path.join(src, 'fingerprint.json');
      if (fs.existsSync(fpSrc)) fs.copyFileSync(fpSrc, fpDst);

      restored.push(slotIndex);
    }
    return restored.sort((a, b) => a - b);
  }

  private async computeCurrentSchemaHash(): Promise<string> {
    const rows: Array<{ max: string | null }> = await this.dataSource.query(
      'SELECT MAX(timestamp)::text AS max FROM migrations',
    );
    const last = rows?.[0]?.max ?? '0';
    const crypto = await import('node:crypto');
    return crypto.createHash('sha256').update(`migrations:${last}`).digest('hex').slice(0, 16);
  }

  private extractZip(zipBuf: Buffer, outDir: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      yauzl.fromBuffer(zipBuf, { lazyEntries: true }, (err, zipfile) => {
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
