// M9 · TakeoverUploadService 卫生层测试 (D+ 决策 3 条硬约束)

import { BadRequestException } from '@nestjs/common';
import sharp from 'sharp';
import { TakeoverUploadService } from './takeover-upload.service';

async function makeJpegBuffer(): Promise<Buffer> {
  return sharp({
    create: { width: 4, height: 4, channels: 3, background: { r: 255, g: 0, b: 0 } },
  })
    .jpeg()
    .toBuffer();
}

describe('TakeoverUploadService', () => {
  let svc: TakeoverUploadService;
  beforeEach(() => {
    svc = new TakeoverUploadService();
  });

  it('rejects file exceeding 95MB', async () => {
    const big = Buffer.alloc(96 * 1024 * 1024); // 96MB
    await expect(
      svc.sanitize({ buffer: big, mimeType: 'image/jpeg', filename: 'big.jpg', type: 'image' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects empty buffer', async () => {
    await expect(
      svc.sanitize({ buffer: Buffer.alloc(0), mimeType: 'image/jpeg', filename: 'x.jpg', type: 'image' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects disallowed MIME for image type', async () => {
    const buf = await makeJpegBuffer();
    await expect(
      svc.sanitize({ buffer: buf, mimeType: 'application/octet-stream', filename: 'x.jpg', type: 'image' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts jpeg/png/webp/gif for image', async () => {
    const buf = await makeJpegBuffer();
    const mimes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    for (const m of mimes) {
      const result = await svc.sanitize({ buffer: buf, mimeType: m, filename: 'a.jpg', type: 'image' });
      expect(result.buffer.length).toBeGreaterThan(0);
    }
  });

  it('accepts ogg/mp3/m4a for voice', async () => {
    const fake = Buffer.from('fake audio bytes');
    for (const m of ['audio/ogg; codecs=opus', 'audio/mpeg', 'audio/m4a', 'audio/mp4']) {
      const result = await svc.sanitize({ buffer: fake, mimeType: m, filename: 'a.ogg', type: 'voice' });
      expect(result.size).toBeGreaterThan(0);
      expect(result.strippedExif).toBe(false); // 语音不过 sharp
    }
  });

  it('accepts pdf/docx/xlsx/zip for file type · rejects exe', async () => {
    const fake = Buffer.from('fake bytes');
    for (const m of [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/zip',
    ]) {
      const r = await svc.sanitize({ buffer: fake, mimeType: m, filename: 'x.bin', type: 'file' });
      expect(r.size).toBeGreaterThan(0);
    }
    await expect(
      svc.sanitize({ buffer: fake, mimeType: 'application/x-msdownload', filename: 'evil.exe', type: 'file' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('image path · EXIF stripped (strippedExif=true) · sharp 输出默认无 metadata', async () => {
    const buf = await makeJpegBuffer();
    const r = await svc.sanitize({ buffer: buf, mimeType: 'image/jpeg', filename: 'photo.jpg', type: 'image' });
    expect(r.strippedExif).toBe(true);
    // 验证输出 image 仍有效
    const meta = await sharp(r.buffer).metadata();
    expect(meta.width).toBe(4);
  });

  it('filename · 去除 ../ 路径遍历字符, ASCII-safe', async () => {
    const fake = Buffer.from('x');
    const r = await svc.sanitize({
      buffer: fake,
      mimeType: 'application/pdf',
      filename: '../../etc/passwd\\evil.pdf',
      type: 'file',
    });
    expect(r.filename).not.toContain('..');
    expect(r.filename).not.toContain('/');
    expect(r.filename).not.toContain('\\');
  });
});
