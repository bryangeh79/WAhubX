import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScriptPackEntity } from './script-pack.entity';
import { ScriptEntity } from './script.entity';
import { RewriteCacheEntity } from './rewrite-cache.entity';
import { AssetEntity } from './asset.entity';
import { PackLoaderService } from './pack-loader.service';
import { ScriptRunnerService } from './script-runner.service';
import { ScriptChatExecutor } from './script-chat.executor';
import { ScriptsController } from './scripts.controller';
import { BaileysModule } from '../baileys/baileys.module';
import { SlotsModule } from '../slots/slots.module';
import { WarmupModule } from '../warmup/warmup.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ScriptPackEntity, ScriptEntity, RewriteCacheEntity, AssetEntity]),
    BaileysModule,
    SlotsModule, // AccountSlotEntity / WaAccountEntity 走 SlotsModule 的 TypeOrmModule
    WarmupModule, // WarmupPairService 给 ScriptChatExecutor 运行时配对 (单向依赖, WarmupModule 不反向 import ScriptsModule)
  ],
  controllers: [ScriptsController],
  providers: [PackLoaderService, ScriptRunnerService, ScriptChatExecutor],
  exports: [PackLoaderService, ScriptRunnerService, ScriptChatExecutor],
})
export class ScriptsModule {}
