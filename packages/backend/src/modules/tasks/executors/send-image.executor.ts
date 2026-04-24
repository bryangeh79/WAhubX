import { Injectable } from '@nestjs/common';
import { SendMediaExecutorBase } from './send-media.executor-base';
import { AssetKind } from '../../scripts/asset.entity';

@Injectable()
export class SendImageExecutor extends SendMediaExecutorBase {
  readonly taskType = 'send_image';
  protected readonly kind = AssetKind.Image;
  protected readonly mediaType = 'image' as const;
}
