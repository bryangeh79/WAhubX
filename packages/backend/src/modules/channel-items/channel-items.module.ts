import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChannelItemEntity } from './channel-item.entity';
import { ChannelItemsService } from './channel-items.service';
import { AdminChannelItemsController } from './admin-channel-items.controller';

@Module({
  imports: [TypeOrmModule.forFeature([ChannelItemEntity])],
  controllers: [AdminChannelItemsController],
  providers: [ChannelItemsService],
  exports: [ChannelItemsService],
})
export class ChannelItemsModule {}
