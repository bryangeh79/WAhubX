import { Injectable } from '@nestjs/common';
import { SendMediaExecutorBase } from './send-media.executor-base';
import { AssetKind } from '../../scripts/asset.entity';

@Injectable()
export class SendVoiceExecutor extends SendMediaExecutorBase {
  readonly taskType = 'send_voice';
  protected readonly kind = AssetKind.Voice;
  protected readonly mediaType = 'voice' as const;
}
