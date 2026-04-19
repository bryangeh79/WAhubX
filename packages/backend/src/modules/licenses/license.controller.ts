import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { LicenseService, type ActivationResult, type LicenseStatusView } from './license.service';
import { ActivateLicenseDto } from './dto/activate-license.dto';
import { VerifyLicenseDto } from './dto/verify-license.dto';
import { Public } from '../auth/decorators/public.decorator';

// License endpoints 都是公开的 (激活发生在 admin user 存在之前)
@Public()
@Controller({ path: 'license', version: '1' })
export class LicenseController {
  constructor(private readonly license: LicenseService) {}

  // 前端启动时调 — 看本机是否已激活
  @Get('status')
  getStatus(): Promise<LicenseStatusView> {
    return this.license.getLocalStatus();
  }

  // 客户本机激活: 绑定 machineId + 创建 admin user
  @Post('activate')
  @HttpCode(HttpStatus.OK)
  activate(@Body() dto: ActivateLicenseDto): Promise<ActivationResult> {
    return this.license.activate(dto);
  }

  // 定期验证 (本机 → 本机 DB V1 简化; V2 接 VPS License Server)
  @Post('verify')
  @HttpCode(HttpStatus.OK)
  verify(@Body() dto: VerifyLicenseDto) {
    return this.license.verify(dto);
  }
}
