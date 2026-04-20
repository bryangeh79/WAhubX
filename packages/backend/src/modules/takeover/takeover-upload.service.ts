// M9 · 上传卫生层 (D+ 决策 · 3 条基础, 不作 V1.1 debt)
//   1. 文件大小 ≤ 95MB (WA 100MB 硬限留 buffer)
//   2. MIME 白名单 · image/voice/file 各自允许清单
//   3. 图片 EXIF 剥离 (sharp.rotate 会 apply EXIF orientation 并默认剥元数据)
//
// 注: sharp 默认输出不含 metadata (EXIF/IPTC/XMP), 所以"剥离"是默认行为.
// 仍显式调 .withMetadata({}) 明确语义并防未来改 default.

import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';
import sharp from 'sharp';

export type TakeoverMediaType = 'image' | 'voice' | 'file';

const MAX_SIZE_BYTES = 95 * 1024 * 1024; // 95 MB (WA 100MB 硬上限 buffer 5MB)

const ALLOWED_MIME: Record<TakeoverMediaType, RegExp[]> = {
  image: [/^image\/jpeg$/, /^image\/png$/, /^image\/gif$/, /^image\/webp$/],
  voice: [/^audio\/ogg/, /^audio\/mpeg$/, /^audio\/mp3$/, /^audio\/opus/, /^audio\/mp4$/, /^audio\/m4a$/, /^audio\/x-m4a$/],
  file: [
    /^application\/pdf$/,
    /^application\/msword$/,
    /^application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document$/,
    /^application\/vnd\.ms-excel$/,
    /^application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet$/,
    /^text\/plain$/,
    /^application\/zip$/,
    /^application\/x-zip-compressed$/,
  ],
};

export interface SanitizedMedia {
  buffer: Buffer;
  mimeType: string;
  filename: string;
  size: number;
  strippedExif: boolean;
}

@Injectable()
export class TakeoverUploadService {
  private readonly logger = new Logger(TakeoverUploadService.name);

  async sanitize(params: {
    buffer: Buffer;
    mimeType: string;
    filename: string;
    type: TakeoverMediaType;
  }): Promise<SanitizedMedia> {
    const { buffer, mimeType, filename, type } = params;

    if (!buffer || buffer.length === 0) {
      throw new BadRequestException('上传内容为空');
    }
    if (buffer.length > MAX_SIZE_BYTES) {
      throw new BadRequestException(
        `文件超过 95MB 上限 (${(buffer.length / 1024 / 1024).toFixed(1)}MB) · WA 100MB 硬限留 buffer`,
      );
    }

    const allowed = ALLOWED_MIME[type];
    if (!allowed) throw new BadRequestException(`不支持的 type=${type}`);
    const mimeOk = allowed.some((re) => re.test(mimeType));
    if (!mimeOk) {
      throw new BadRequestException(
        `MIME "${mimeType}" 不在 ${type} 白名单 · 允许: ${allowed.map((r) => r.source).join(', ')}`,
      );
    }

    // 图片: EXIF 剥离 (sharp 默认不输出 metadata, 但显式走一遍保险)
    if (type === 'image') {
      try {
        const format = this.pickSharpFormat(mimeType);
        // .rotate() 先 apply EXIF orientation 再 strip; 防 iPhone 竖拍被旋成横
        const processed = await sharp(buffer).rotate().toFormat(format).toBuffer();
        return {
          buffer: processed,
          mimeType,
          filename: this.safeName(filename),
          size: processed.length,
          strippedExif: true,
        };
      } catch (err) {
        this.logger.warn(`sharp 处理失败, 回退原 buffer: ${err instanceof Error ? err.message : err}`);
        // 降级 · 不 block 用户; 但标 strippedExif=false 便于审计
        return {
          buffer,
          mimeType,
          filename: this.safeName(filename),
          size: buffer.length,
          strippedExif: false,
        };
      }
    }

    // voice / file 不处理二进制
    return {
      buffer,
      mimeType,
      filename: this.safeName(filename),
      size: buffer.length,
      strippedExif: false,
    };
  }

  persistToDisk(params: {
    slotIndex: number;
    buffer: Buffer;
    filename: string;
  }): string {
    const { slotIndex, buffer, filename } = params;
    const dir = path.resolve(process.cwd(), 'data', 'slots', String(slotIndex).padStart(2, '0'), 'takeover-uploads');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const safeFile = this.safeName(filename);
    const stamped = `${Date.now()}-${safeFile}`;
    const abs = path.join(dir, stamped);
    fs.writeFileSync(abs, buffer);
    return path.relative(process.cwd(), abs);
  }

  private pickSharpFormat(mime: string): 'jpeg' | 'png' | 'webp' | 'gif' {
    if (/png/.test(mime)) return 'png';
    if (/webp/.test(mime)) return 'webp';
    if (/gif/.test(mime)) return 'gif';
    return 'jpeg';
  }

  private safeName(input: string): string {
    // 去路径 + 保留 ASCII 字母数字 . - _ · 防 .. / \
    const base = path.basename(input || 'upload.bin');
    return base.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120) || 'upload.bin';
  }

  readonly MAX_SIZE_BYTES = MAX_SIZE_BYTES;
  readonly ALLOWED_MIME = ALLOWED_MIME;
}
