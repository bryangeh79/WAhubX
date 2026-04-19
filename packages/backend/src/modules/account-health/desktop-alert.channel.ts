import { Injectable, Logger } from '@nestjs/common';
import * as notifier from 'node-notifier';
import type { AlertChannel, AlertPayload } from './alert-channel';

// 桌面弹窗 · node-notifier 跨 Win/Mac/Linux 原生 toast
// 生产 installer (M11) 会附带 notifier 二进制 (SnoreToast for Windows / alerter for Mac),
// dev 环境用 node-notifier 默认回退 (Windows: Balloon, Mac: osascript, Linux: notify-send)
//
// 行为:
//  dry_run = true → title 前缀 "[DRY-RUN]"
//  critical → 强调标题 · 带图标 (prod installer 带 logo 后生效)
@Injectable()
export class DesktopAlertChannel implements AlertChannel {
  readonly channelName = 'desktop';
  private readonly logger = new Logger(DesktopAlertChannel.name);

  async send(payload: AlertPayload): Promise<void> {
    const prefix = payload.dryRun ? '[DRY-RUN] ' : '';
    const severityTag = payload.severity === 'critical' ? '🔴 ' : payload.severity === 'warn' ? '🟡 ' : 'ℹ️ ';
    const title = `${prefix}${severityTag}WAhubX: ${payload.title}`;
    try {
      await new Promise<void>((resolve) => {
        notifier.notify(
          {
            title,
            message: payload.message,
            // 图标 TODO (M11 installer 打进 logo.png 路径)
          },
          (err) => {
            if (err) {
              this.logger.warn(`desktop notify failed: ${err.message}`);
            }
            resolve(); // 不抛, 告警丢失不算 fatal
          },
        );
      });
    } catch (err) {
      this.logger.warn(`desktop notify threw: ${err instanceof Error ? err.message : err}`);
    }
  }
}
