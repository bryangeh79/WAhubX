// M9 · 桥接 takeover idle 事件 → AlertDispatcher (复用 M8 §B.25 channel fan-out)
// socket.io 推 UI 是主渠道, 桌面 toast 是当 UI 被最小化 / 断连时的兜底.

import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { AlertDispatcherService } from '../account-health/alert-dispatcher.service';
import {
  TAKEOVER_IDLE_TIMEOUT,
  TAKEOVER_IDLE_WARNING,
  type TakeoverIdleEvent,
} from './takeover.events';

@Injectable()
export class TakeoverAlertRelay {
  private readonly logger = new Logger(TakeoverAlertRelay.name);

  constructor(private readonly alerts: AlertDispatcherService) {}

  @OnEvent(TAKEOVER_IDLE_WARNING)
  async onIdleWarning(ev: TakeoverIdleEvent): Promise<void> {
    await this.alerts.dispatch({
      title: '接管即将超时',
      message: `账号 ${ev.accountId} 接管已闲置 ${ev.minutesIdle} 分钟, 2 分钟后自动释放锁`,
      severity: 'warn',
      type: 'takeover_idle_warning',
      accountId: ev.accountId,
    });
  }

  @OnEvent(TAKEOVER_IDLE_TIMEOUT)
  async onIdleTimeout(ev: TakeoverIdleEvent): Promise<void> {
    await this.alerts.dispatch({
      title: '接管已自动释放',
      message: `账号 ${ev.accountId} 接管闲置 ${ev.minutesIdle} 分钟超时, 锁已自动释放, 任务恢复调度`,
      severity: 'info',
      type: 'takeover_idle_timeout',
      accountId: ev.accountId,
    });
    this.logger.log(`idle timeout alert dispatched · acc=${ev.accountId}`);
  }
}
