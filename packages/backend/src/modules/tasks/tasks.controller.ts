import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { TasksService } from './tasks.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { TaskStatus } from './task.entity';
import { CurrentUser, type RequestUser } from '../auth/decorators/current-user.decorator';

@Controller({ path: 'tasks', version: '1' })
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Post()
  async create(@CurrentUser() cur: RequestUser, @Body() dto: CreateTaskDto) {
    if (cur.tenantId === null) {
      throw new BadRequestException('平台超管需指定租户; 改走租户 admin');
    }
    return this.tasks.createForTenant(cur.tenantId, dto);
  }

  @Get()
  async list(
    @CurrentUser() cur: RequestUser,
    @Query('status') status?: string,
  ) {
    const statusEnum = status && (Object.values(TaskStatus) as string[]).includes(status)
      ? (status as TaskStatus)
      : undefined;
    return this.tasks.listForTenant(cur.tenantId, { status: statusEnum });
  }

  @Get('queue/running')
  async running(@CurrentUser() cur: RequestUser) {
    return this.tasks.listRunning(cur.tenantId);
  }

  @Get('queue/pending')
  async pending(@CurrentUser() cur: RequestUser) {
    return this.tasks.listQueued(cur.tenantId);
  }

  @Get('queue/failed-recent')
  async failed(@CurrentUser() cur: RequestUser) {
    return this.tasks.listRecentFailed(cur.tenantId);
  }

  @Get(':id')
  async findOne(@CurrentUser() cur: RequestUser, @Param('id', ParseIntPipe) id: number) {
    return this.tasks.findOne(id, cur.tenantId);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(@CurrentUser() cur: RequestUser, @Param('id', ParseIntPipe) id: number) {
    return this.tasks.cancel(id, cur.tenantId);
  }

  @Get(':id/chat')
  async chatMessages(@CurrentUser() cur: RequestUser, @Param('id', ParseIntPipe) id: number) {
    return this.tasks.getChatMessages(id, cur.tenantId);
  }

  @Get(':id/logs')
  async getLogs(@CurrentUser() cur: RequestUser, @Param('id', ParseIntPipe) id: number) {
    return this.tasks.getLogs(id, cur.tenantId);
  }

  @Post(':id/rerun')
  @HttpCode(HttpStatus.CREATED)
  async rerun(@CurrentUser() cur: RequestUser, @Param('id', ParseIntPipe) id: number) {
    return this.tasks.rerun(id, cur.tenantId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() cur: RequestUser, @Param('id', ParseIntPipe) id: number) {
    await this.tasks.remove(id, cur.tenantId);
  }
}
