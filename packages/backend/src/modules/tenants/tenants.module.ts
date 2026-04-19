import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantEntity } from './tenant.entity';
import { AdminTenantsController } from './admin-tenants.controller';
import { SlotsModule } from '../slots/slots.module';

@Module({
  imports: [TypeOrmModule.forFeature([TenantEntity]), SlotsModule],
  controllers: [AdminTenantsController],
  exports: [TypeOrmModule],
})
export class TenantsModule {}
