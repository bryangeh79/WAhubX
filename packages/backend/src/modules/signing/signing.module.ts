// M11 Day 2 · SigningModule · 独立 crypto module
//
// 设计约束:
//   - 不 import M8 health / dispatcher / risk / scorer
//   - 不 import M10 backup (backup module 反过来可能会 import 本模块做 .wupd manifest 签名 · M11 Day 3-4)
//   - 纯 stateless service · 无 DB 依赖
//   - @Global 让 M11 Day 3-4 UpdateService 直接 inject 不需显式 import

import { Global, Module } from '@nestjs/common';
import { Ed25519SignerService } from './ed25519-signer.service';
import { Ed25519VerifierService } from './ed25519-verifier.service';

@Global()
@Module({
  providers: [Ed25519SignerService, Ed25519VerifierService],
  exports: [Ed25519SignerService, Ed25519VerifierService],
})
export class SigningModule {}
