import { Controller, Get, HttpCode, HttpStatus, ServiceUnavailableException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Controller({ path: 'health', version: '1' })
export class HealthController {
  private readonly startedAt = Date.now();

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  @Get()
  check() {
    return {
      status: 'ok',
      service: 'wahubx-backend',
      version: process.env.npm_package_version ?? '0.1.0',
      uptime_sec: Math.floor((Date.now() - this.startedAt) / 1000),
      timestamp: new Date().toISOString(),
    };
  }

  @Get('db')
  @HttpCode(HttpStatus.OK)
  async checkDb() {
    try {
      const result = await this.dataSource.query<{ now: Date }[]>('SELECT NOW() as now');
      return {
        status: 'ok',
        driver: this.dataSource.driver.database,
        server_time: result[0]?.now,
      };
    } catch (err) {
      throw new ServiceUnavailableException({
        status: 'error',
        message: err instanceof Error ? err.message : 'DB ping failed',
      });
    }
  }
}
