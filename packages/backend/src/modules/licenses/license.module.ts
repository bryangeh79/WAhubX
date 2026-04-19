import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LicenseEntity } from './license.entity';
import { LicenseService } from './license.service';
import { LicenseController } from './license.controller';
import { AdminLicensesController } from './admin-licenses.controller';
import { TenantEntity } from '../tenants/tenant.entity';
import { User } from '../users/user.entity';

@Module({
  imports: [TypeOrmModule.forFeature([LicenseEntity, TenantEntity, User])],
  controllers: [LicenseController, AdminLicensesController],
  providers: [LicenseService],
  exports: [LicenseService],
})
export class LicenseModule {}
