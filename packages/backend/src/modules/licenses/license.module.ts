import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LicenseEntity } from './license.entity';
import { LicenseService } from './license.service';
import { LicenseController } from './license.controller';
import { AdminLicensesController } from './admin-licenses.controller';
import { TenantEntity } from '../tenants/tenant.entity';
import { User } from '../users/user.entity';
import { SlotsModule } from '../slots/slots.module';
import { LicenseServerClient } from './license-server-client.service';

@Module({
  imports: [TypeOrmModule.forFeature([LicenseEntity, TenantEntity, User]), SlotsModule],
  controllers: [LicenseController, AdminLicensesController],
  providers: [LicenseService, LicenseServerClient],
  exports: [LicenseService, LicenseServerClient],
})
export class LicenseModule {}
