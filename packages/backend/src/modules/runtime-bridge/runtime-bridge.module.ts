// 2026-04-25 · D8-1 · RuntimeBridgeModule
//
// 把 WS gateway 作为独立 Nest module 挂在 AppModule.
// 业务模块 (BaileysService / SlotsService 等) 通过 inject RuntimeBridgeService 来发命令.

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { RuntimeBridgeService } from './runtime-bridge.service';
import { RuntimeBridgeController } from './runtime-bridge.controller';
import { ScreencastGateway } from './screencast.gateway';

@Module({
  imports: [ConfigModule, JwtModule.register({})],
  controllers: [RuntimeBridgeController],
  providers: [RuntimeBridgeService, ScreencastGateway],
  exports: [RuntimeBridgeService],
})
export class RuntimeBridgeModule {}
