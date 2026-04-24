import { Injectable } from '@nestjs/common';
import { SendMediaExecutorBase } from './send-media.executor-base';
import { AssetKind } from '../../scripts/asset.entity';

@Injectable()
export class SendVideoExecutor extends SendMediaExecutorBase {
  readonly taskType = 'send_video';
  protected readonly kind = AssetKind.Video;
  protected readonly mediaType = 'video' as const;
}
