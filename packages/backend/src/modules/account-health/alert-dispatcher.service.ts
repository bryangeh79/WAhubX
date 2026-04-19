import { Inject, Injectable, Logger } from '@nestjs/common';
import { ALERT_CHANNELS, type AlertChannel, type AlertPayload } from './alert-channel';

// 聚合所有已注册 channel, 并发 fan-out
@Injectable()
export class AlertDispatcherService {
  private readonly logger = new Logger(AlertDispatcherService.name);

  constructor(@Inject(ALERT_CHANNELS) private readonly channels: AlertChannel[]) {
    this.logger.log(
      `AlertDispatcher ready · ${this.channels.length} channels: ${this.channels.map((c) => c.channelName).join(', ')}`,
    );
  }

  async dispatch(payload: AlertPayload): Promise<void> {
    await Promise.all(
      this.channels.map(async (c) => {
        try {
          await c.send(payload);
        } catch (err) {
          this.logger.warn(`channel ${c.channelName} failed: ${err instanceof Error ? err.message : err}`);
        }
      }),
    );
  }
}
