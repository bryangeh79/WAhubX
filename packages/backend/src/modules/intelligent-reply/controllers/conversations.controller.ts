import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Query,
} from '@nestjs/common';
import { CurrentUser, type RequestUser } from '../../auth/decorators/current-user.decorator';
import { ReplyExecutorService } from '../services/reply-executor.service';
import {
  ConversationStage,
  CustomerConversationEntity,
} from '../entities/customer-conversation.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

@Controller({ path: 'conversations', version: '1' })
export class ConversationsController {
  constructor(
    private readonly executor: ReplyExecutorService,
    @InjectRepository(CustomerConversationEntity)
    private readonly convRepo: Repository<CustomerConversationEntity>,
  ) {}

  private tenantOf(cur: RequestUser): number {
    if (cur.tenantId === null) throw new BadRequestException('请切换到租户视角');
    return cur.tenantId;
  }

  @Get('pending')
  listPending(@CurrentUser() cur: RequestUser) {
    return this.executor.listPendingHandoffs(this.tenantOf(cur));
  }

  @Get()
  async list(
    @CurrentUser() cur: RequestUser,
    @Query('stage') stage?: string,
  ) {
    const stages = stage
      ? (stage.split(',') as ConversationStage[])
      : [
          ConversationStage.New,
          ConversationStage.Interested,
          ConversationStage.HotLead,
          ConversationStage.HandoffRequired,
          ConversationStage.HumanTakeover,
        ];
    return this.executor.listByStages(this.tenantOf(cur), stages);
  }

  @Get(':id')
  async get(@CurrentUser() cur: RequestUser, @Param('id', ParseIntPipe) id: number) {
    const tid = this.tenantOf(cur);
    const row = await this.convRepo.findOne({ where: { id, tenantId: tid } });
    if (!row) throw new BadRequestException(`对话 ${id} 不存在`);
    return row;
  }

  @Patch(':id/stage')
  async setStage(
    @CurrentUser() cur: RequestUser,
    @Param('id', ParseIntPipe) id: number,
    @Body('stage') stage: ConversationStage,
  ) {
    return this.executor.markConversationStage(this.tenantOf(cur), id, stage);
  }
}
