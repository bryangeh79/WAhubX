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
import { PersonaGeneratorService } from './persona-generator.service';
import { PersonaPoolScheduler } from './persona-pool.scheduler';
import { PersonaEntity } from './persona.entity';
import { AssetEntity } from '../scripts/asset.entity';
import { AiModule } from '../ai/ai.module';

// Note: AvatarGeneratorService + FluxService + PiperService 需 FluxModule/PiperModule 提供
// 这些 M7 Day 8 batch smoke 时才 wire · AssetsTab UI 不直接调
@Module({
  imports: [TypeOrmModule.forFeature([PersonaEntity, AssetEntity]), AiModule],
  controllers: [AssetsController],
  providers: [AssetService, PersonaGeneratorService, PersonaPoolScheduler],
  exports: [AssetService, PersonaGeneratorService],
})
export class AssetsModule {}
