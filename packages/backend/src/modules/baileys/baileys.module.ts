import { Module } from '@nestjs/common';
import { BaileysService } from './baileys.service';

// 独立模块保证 Baileys 依赖的生命周期 + logger 注入清晰. M2 W2 加入消息收发 service 时也挂这里.
@Module({
  providers: [BaileysService],
  exports: [BaileysService],
})
export class BaileysModule {}
