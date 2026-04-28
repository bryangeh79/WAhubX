import { Injectable, Logger, BadRequestException } from '@nestjs/common';

// 2026-04-24 · 文件解析 · PDF / docx / txt → 纯文本
// 使用动态 import 避免冷启动加载这两个大库 (pdf-parse 有 JS ~2MB, mammoth 更大)

@Injectable()
export class FileParserService {
  private readonly logger = new Logger(FileParserService.name);

  /**
   * 根据文件名/mime 自动判别, 返回解析出的纯文本
   */
  async parse(
    buffer: Buffer,
    fileName: string,
    mime?: string,
  ): Promise<{ text: string; kind: 'pdf' | 'docx' | 'txt' }> {
    const lower = (fileName || '').toLowerCase();
    if (lower.endsWith('.pdf') || mime === 'application/pdf') {
      return { text: await this.parsePdf(buffer), kind: 'pdf' };
    }
    if (
      lower.endsWith('.docx') ||
      mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ) {
      return { text: await this.parseDocx(buffer), kind: 'docx' };
    }
    if (lower.endsWith('.txt') || lower.endsWith('.md') || (mime && mime.startsWith('text/'))) {
      return { text: buffer.toString('utf8'), kind: 'txt' };
    }
    throw new BadRequestException(`不支持的文件格式: ${fileName} (${mime ?? '未知'})`);
  }

  private async parsePdf(buffer: Buffer): Promise<string> {
    let parser: { getText: () => Promise<{ text: string }>; destroy: () => Promise<void> } | null = null;
    try {
      // 2026-04-28 · pdf-parse v2.4.5 API 已彻底变 (老 default fn → 新 PDFParse class)
      //   老: import pdfParse from 'pdf-parse'; await pdfParse(buffer)
      //   新: import { PDFParse } from 'pdf-parse'; new PDFParse({ data: buffer }).getText()
      //   bug: 老兼容写法 mod.default ?? mod 都不命中 fn (新 mod 没 default 也不是 fn) → "pdfParse is not a function"
      const mod = (await import('pdf-parse')) as unknown as {
        PDFParse?: new (opts: { data: Buffer | Uint8Array }) => {
          getText: () => Promise<{ text: string }>;
          destroy: () => Promise<void>;
        };
        default?: (b: Buffer) => Promise<{ text: string }>;
      };

      // 优先新 API (v2+)
      if (typeof mod.PDFParse === 'function') {
        parser = new mod.PDFParse({ data: buffer });
        const result = await parser.getText();
        return this.cleanText(result.text ?? '');
      }

      // 回退老 API (v1/v0 默认 fn 兼容)
      if (typeof mod.default === 'function') {
        const data = await mod.default(buffer);
        return this.cleanText((data as unknown as { text?: string }).text ?? '');
      }

      throw new Error('pdf-parse 模块没有 PDFParse class 也没有 default 函数 · 版本不兼容');
    } catch (err) {
      this.logger.warn(`parsePdf failed: ${err instanceof Error ? err.message : err}`);
      throw new BadRequestException(`PDF 解析失败 · ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      // 释放 pdfjs worker · 防内存泄
      if (parser) {
        try {
          await parser.destroy();
        } catch {
          /* ignore */
        }
      }
    }
  }

  private async parseDocx(buffer: Buffer): Promise<string> {
    try {
      const mammoth = await import('mammoth');
      const extractor = (mammoth as unknown as {
        extractRawText?: (opts: { buffer: Buffer }) => Promise<{ value: string }>;
        default?: { extractRawText: (opts: { buffer: Buffer }) => Promise<{ value: string }> };
      });
      const fn = extractor.extractRawText ?? extractor.default?.extractRawText;
      if (!fn) throw new Error('mammoth.extractRawText 不可用');
      const result = await fn({ buffer });
      return this.cleanText(result.value ?? '');
    } catch (err) {
      this.logger.warn(`parseDocx failed: ${err instanceof Error ? err.message : err}`);
      throw new BadRequestException(`Word 解析失败 · ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private cleanText(raw: string): string {
    return raw
      .replace(/\r\n/g, '\n')
      .replace(/\t/g, ' ')
      .replace(/[ ]{2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /**
   * 按 ~500 字切 chunk, 带 50 字 overlap · 用于 embedding 后检索
   * 简单按段落+字符数切, 不用 tokenizer (足够 V1)
   */
  chunk(text: string, targetSize = 500, overlap = 50): string[] {
    if (!text) return [];
    const paragraphs = text
      .split(/\n\n+/)
      .map((p) => p.trim())
      .filter(Boolean);

    const out: string[] = [];
    let buf = '';

    for (const p of paragraphs) {
      if (buf.length + p.length + 2 <= targetSize * 1.3) {
        buf = buf ? `${buf}\n\n${p}` : p;
      } else {
        if (buf) out.push(buf);
        // 若单段超长 · 硬切
        if (p.length > targetSize * 1.5) {
          for (let i = 0; i < p.length; i += targetSize - overlap) {
            out.push(p.slice(i, i + targetSize));
          }
          buf = '';
        } else {
          buf = p;
        }
      }
    }
    if (buf) out.push(buf);
    return out;
  }

  /**
   * 从原文抽取 "受保护实体" (联系方式/公司名等 · guardrail 用)
   * 正则层, LLM 验证待后续
   */
  extractProtectedEntities(text: string): Array<{ type: string; value: string }> {
    const entities: Array<{ type: string; value: string }> = [];
    const seen = new Set<string>();

    // Email
    for (const m of text.matchAll(/[\w.+-]+@[\w-]+\.[\w.-]+/g)) {
      const v = m[0];
      if (!seen.has(`email:${v}`)) {
        entities.push({ type: 'email', value: v });
        seen.add(`email:${v}`);
      }
    }
    // URL (http/https/wa.me)
    for (const m of text.matchAll(/https?:\/\/[^\s)]+/gi)) {
      const v = m[0].replace(/[.,;:)\]]+$/, '');
      if (!seen.has(`url:${v}`)) {
        entities.push({ type: 'url', value: v });
        seen.add(`url:${v}`);
      }
    }
    // Phone (8-15 digits · 粗略 MY/国际号)
    for (const m of text.matchAll(/(?:\+?60|\+?\d{1,3})?[\s-]?\d{2,4}[\s-]?\d{3,4}[\s-]?\d{3,5}/g)) {
      const raw = m[0].replace(/[\s-]/g, '');
      // 至少 8 位数字才保留
      if (raw.replace(/\D/g, '').length >= 8 && raw.replace(/\D/g, '').length <= 15) {
        if (!seen.has(`phone:${raw}`)) {
          entities.push({ type: 'phone', value: raw });
          seen.add(`phone:${raw}`);
        }
      }
    }
    return entities;
  }
}
