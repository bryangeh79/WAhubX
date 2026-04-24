// M7 Day 6 · AssetsModule
//
// 注册: AssetsController + AssetService + PersonaGeneratorService + AvatarGeneratorService +
//        FluxService + PiperService + PersonaPoolScheduler
//
// FluxService / PiperService 由外部 (app level) factory 构造 · 本 module 注入
// (PiperAdapter 无 DI · 直 new)

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AssetsController } from './assets.controller';
import { AssetService } from './asset.service';
import { AssetPoolService } from './asset-pool.service';
import { PersonaGeneratorService } from './persona-generator.service';
import { AvatarGeneratorService } from './avatar-generator.service';
import { PersonaPoolScheduler } from './persona-pool.scheduler';
import { PersonaEntity } from './persona.entity';
import { AssetEntity } from '../scripts/asset.entity';
import { AiModule } from '../ai/ai.module';
import { FluxModule } from './flux/flux.module';
import { PiperModule } from './piper/piper.module';

// M7 Day 8 · Flux + Piper modules wired · AvatarGenerator 现可 DI 注入
@Module({
  imports: [
    TypeOrmModule.forFeature([PersonaEntity, AssetEntity]),
    AiModule,
    FluxModule,
    PiperModule,
  ],
  controllers: [AssetsController],
  providers: [
    AssetService,
    AssetPoolService,
    PersonaGeneratorService,
    AvatarGeneratorService,
    PersonaPoolScheduler,
  ],
  exports: [AssetService, AssetPoolService, PersonaGeneratorService, AvatarGeneratorService],
})
export class AssetsModule {}
