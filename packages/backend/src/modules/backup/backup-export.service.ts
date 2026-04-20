// M10 · .wab 手动导出 (§B.11 Layer 2)
//
// 流程:
//   1. pg_dump via docker exec · 拿完整 DB SQL (含 schema + data + DROP/CREATE · 可 self-restore)
//   2. 扫所有 slot 目录 · whitelist 打 zip (wa-session + fingerprint.json)
//   3. 组装 inner zip: db.sql + slots/slot_NN.zip + manifest.json (inner)
//   4. WabCodec encode (外层 AES-256-GCM + magic bytes)
//   5. 写 backups/<subdir>/<name>.wab
//
// 外部调用点:
//   - ManualExport (Admin UI 按钮): subdir=manual
//   - PreMigrationBackup (E1 前): subdir=pre-migration
//   - PreImportBackup (F+ 前): subdir=pre-import
//
// pg_dump 选项:
//   --clean --if-exists → DROP TABLE IF EXISTS 确保干净重建
//   --no-owner --no-privileges → 跨 role 恢复安全 (本地 dev/prod 可能 role 名不同)

import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import * as archiver from 'archiver';
import { exec } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { getSlotDir } from '../../common/storage';
import { AccountSlotEntity } from '../slots/account-slot.entity';
import { MASTER_KEY_PROVIDER, type MasterKeyProvider } from '../ai/master-key.provider';
import { encodeWab, type WabManifest } from './wab-codec';
import { getManualDir, getPreImportDir, getPreMigrationDir, getPreUpdateDir } from './backup-paths';

const execAsync = promisify(exec);

// M11 Day 4 · 加 'pre-update' · 升级前自动快照
export type ExportSource = 'manual-export' | 'pre-migration' | 'pre-import' | 'pre-update';

export interface ExportResult {
  filePath: string;
  sizeBytes: number;
  manifest: WabManifest;
}

@Injectable()
export class BackupExportService {
  private readonly logger = new Logger(BackupExportService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(MASTER_KEY_PROVIDER) private readonly masterKey: MasterKeyProvider,
  ) {}

  /**
   * 导出全库 + 所有 slots · 加密为 .wab
   * notes: 可选备注 (显示在 manifest)
   * overrideKey: E1/E2 recovery 路径可传入自定义 key (比如 env key 做 pre-migration 备份)
   */
  async export(params: {
    source: ExportSource;
    notes?: string;
    tenantId?: number | null;
    overrideKey?: Buffer;
  }): Promise<ExportResult> {
    const started = Date.now();

    // 1. pg_dump
    const dumpSql = await this.pgDump();
    this.logger.log(`pg_dump ok · size=${Math.round(dumpSql.length / 1024)}KB`);

    // 2. 扫所有 slots (含空槽的 fingerprint.json · 便于重建一致性)
    const slots = await this.dataSource.getRepository(AccountSlotEntity).find();

    // 3. 组装 inner zip
    const innerZip = await this.buildInnerZip(dumpSql, slots.map((s) => s.slotIndex));

    // 4. manifest
    const manifest: WabManifest = {
      app_version: process.env.npm_package_version ?? '0.10.0-m10',
      created_at: new Date().toISOString(),
      schema_hash: await this.computeSchemaHash(),
      slot_count: slots.length,
      has_db: true,
      source: params.source,
      tenant_id: params.tenantId ?? null,
      notes: params.notes,
    };

    // 5. encode
    const key = params.overrideKey ?? this.masterKey.getKey();
    const wab = encodeWab({ innerZip, key, manifest });

    // 6. 写盘
    const dir = this.subdirFor(params.source);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${stamp}_${params.source}.wab`;
    const filePath = path.join(dir, filename);
    fs.writeFileSync(filePath, wab);

    const elapsed = Date.now() - started;
    this.logger.log(
      `export ${params.source} · ${filePath} · ${Math.round(wab.length / 1024)}KB · ${elapsed}ms`,
    );
    return { filePath, sizeBytes: wab.length, manifest };
  }

  /**
   * pg_dump via docker exec · 返 SQL 文本
   * 未来 V1.1 可换 node-pg-dump 纯 node 实现脱 docker 依赖
   */
  private async pgDump(): Promise<string> {
    const container = process.env.WAHUBX_PG_CONTAINER ?? 'wahubx-dev-pg';
    const user = process.env.WAHUBX_PG_USER ?? 'wahubx';
    const db = process.env.WAHUBX_PG_DB ?? 'wahubx';
    const cmd = `docker exec ${container} pg_dump -U ${user} -d ${db} --clean --if-exists --no-owner --no-privileges`;
    try {
      const { stdout, stderr } = await execAsync(cmd, { maxBuffer: 512 * 1024 * 1024 }); // 512MB 上限
      if (stderr && stderr.trim()) this.logger.warn(`pg_dump stderr: ${stderr.slice(0, 500)}`);
      return stdout;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`pg_dump failed: ${msg.slice(0, 500)}`);
    }
  }

  /**
   * Schema hash · 从 migrations 表拿最后一项 timestamp · 拼 NODE env · SHA-256
   * 导入时比较: 不匹配 warn (不 block)
   */
  private async computeSchemaHash(): Promise<string> {
    const rows: Array<{ max: string | null }> = await this.dataSource.query(
      'SELECT MAX(timestamp)::text AS max FROM migrations',
    );
    const last = rows?.[0]?.max ?? '0';
    const crypto = await import('node:crypto');
    return crypto.createHash('sha256').update(`migrations:${last}`).digest('hex').slice(0, 16);
  }

  /**
   * inner zip 构建 · 含 db.sql + slots/slot_NN.zip (每槽单独 zip, 利于部分恢复)
   */
  private async buildInnerZip(dumpSql: string, slotIndexes: number[]): Promise<Buffer> {
    return await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      const archive = archiver.create('zip', { zlib: { level: 6 } });
      archive.on('data', (c) => chunks.push(c));
      archive.on('end', () => resolve(Buffer.concat(chunks)));
      archive.on('warning', (err) => this.logger.warn(`inner-zip warning: ${err}`));
      archive.on('error', reject);

      archive.append(dumpSql, { name: 'db.sql' });

      for (const slotIndex of slotIndexes) {
        const slotDir = getSlotDir(slotIndex);
        const fp = path.join(slotDir, 'fingerprint.json');
        const ws = path.join(slotDir, 'wa-session');
        const slotBuf = Buffer.concat([]);
        // 子 zip 流: 逐文件加 slot-NN/fingerprint.json · slot-NN/wa-session/**
        const prefix = `slots/slot_${String(slotIndex).padStart(2, '0')}`;
        if (fs.existsSync(fp)) archive.file(fp, { name: `${prefix}/fingerprint.json` });
        if (fs.existsSync(ws) && fs.readdirSync(ws).length > 0) {
          archive.directory(ws, `${prefix}/wa-session`);
        }
        // 不嵌套子 zip · 单一外层 zip · 简单 (原方案的"slots/slot_NN.zip" 过设计)
        void slotBuf;
      }
      void archive.finalize();
    });
  }

  private subdirFor(source: ExportSource): string {
    switch (source) {
      case 'manual-export':
        return getManualDir();
      case 'pre-migration':
        return getPreMigrationDir();
      case 'pre-import':
        return getPreImportDir();
      case 'pre-update':
        return getPreUpdateDir();
    }
  }
}
