// M7 Day 8 · FluxModule · wire FluxService from app_setting + env
//
// Settings 键:
//   assets.flux_backend         'auto' | 'flux-local' | 'flux-replicate'
//   assets.flux_local.endpoint  'http://127.0.0.1:8188'
//   assets.flux_replicate.token <encrypted · M6 pattern>
//   assets.flux_replicate.model 'black-forest-labs/flux-dev'
//
// V1 简化: env fallback · Day 6 UI 暂未管理 settings.assets.*
//   - FLUX_BACKEND (default 'auto')
//   - FLUX_LOCAL_ENDPOINT (default 'http://127.0.0.1:8188')
//   - REPLICATE_TOKEN (default '')
//   - REPLICATE_MODEL (default 'black-forest-labs/flux-dev')

import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { FluxService, type FluxBackendMode } from './flux.service';

export const FLUX_SERVICE_TOKEN = Symbol('FLUX_SERVICE');

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: FluxService,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const mode = (config.get<string>('FLUX_BACKEND', 'auto') as FluxBackendMode);
        return new FluxService({
          mode,
          local: {
            endpoint: config.get<string>('FLUX_LOCAL_ENDPOINT', 'http://127.0.0.1:8188'),
          },
          replicate: {
            token: config.get<string>('REPLICATE_TOKEN', ''),
            model: config.get<string>('REPLICATE_MODEL', 'black-forest-labs/flux-dev'),
          },
        });
      },
    },
  ],
  exports: [FluxService],
})
export class FluxModule {}
