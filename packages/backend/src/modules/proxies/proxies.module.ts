import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProxyEntity } from './proxy.entity';
import { AdminProxiesController } from './admin-proxies.controller';

@Module({
  imports: [TypeOrmModule.forFeature([ProxyEntity])],
  controllers: [AdminProxiesController],
  exports: [TypeOrmModule],
})
export class ProxiesModule {}
