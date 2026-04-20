// M7 Day 8 · PiperModule · wire PiperAdapter + PiperService
//
// env:
//   PIPER_BIN_PATH (default 'piper.exe')
//   PIPER_MODELS_DIR (default './models')

import { Module } from '@nestjs/common';
import { PiperAdapter } from './piper-adapter';
import { PiperService } from './piper.service';

@Module({
  providers: [
    {
      provide: PiperAdapter,
      useFactory: () =>
        new PiperAdapter({
          binPath: process.env.PIPER_BIN_PATH ?? 'piper.exe',
        }),
    },
    PiperService,
  ],
  exports: [PiperService, PiperAdapter],
})
export class PiperModule {}
