import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TaskEntity } from './task.entity';
import { TaskRunEntity } from './task-run.entity';
import { TasksService } from './tasks.service';
import { TasksController } from './tasks.controller';
import { DispatcherService } from './dispatcher.service';
import { ExecutorRegistry } from './executor-registry.service';
import { TASK_EXECUTORS } from './executor.interface';
import { ChatExecutor } from './executors/chat.executor';
import { ScriptsModule } from '../scripts/scripts.module';
import { ScriptChatExecutor } from '../scripts/script-chat.executor';
import { WarmupModule } from '../warmup/warmup.module';
import { WarmupExecutor } from './executors/warmup.executor';
import { StatusPostExecutor } from '../warmup/status-post.executor';
import { StatusBrowseExecutor } from '../warmup/status-browse.executor';
// 2026-04-21 · 新增 5 个 executor (task-scheduler-tab.md)
import { JoinGroupExecutor } from './executors/join-group.executor';
import { StatusReactExecutor } from './executors/status-react.executor';
import { AutoAcceptExecutor } from './executors/auto-accept.executor';
import { StatusBrowseBulkExecutor } from './executors/status-browse-bulk.executor';
import { AutoReplyExecutor } from './executors/auto-reply.executor';
import { AddContactExecutor } from './executors/add-contact.executor';
import { GroupChatExecutor } from './executors/group-chat.executor';
import { ProfileRefreshExecutor } from './executors/profile-refresh.executor';
import { SendVoiceExecutor } from './executors/send-voice.executor';
import { SendImageExecutor } from './executors/send-image.executor';
import { SendVideoExecutor } from './executors/send-video.executor';
import { AssetsModule } from '../assets/assets.module';
import { MessagingModule } from '../messaging/messaging.module';
import { AccountSlotEntity } from '../slots/account-slot.entity';
import { WarmupPlanEntity } from '../warmup/warmup-plan.entity';
import { ChannelItemsModule } from '../channel-items/channel-items.module';
import { ChannelItemEntity } from '../channel-items/channel-item.entity';
// 2026-04-23 · 广告投放 send-ad executor 需要注册到 TASK_EXECUTORS · dispatcher 才能捡 task_type='send_ad'
import { CampaignsModule } from '../campaigns/campaigns.module';
import { SendAdExecutor } from '../campaigns/executors/send-ad.executor';
// 2026-04-26 · R9-bis · ChatExecutor 改走 SlotsService.sendText facade
import { SlotsModule } from '../slots/slots.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([TaskEntity, TaskRunEntity, AccountSlotEntity, WarmupPlanEntity, ChannelItemEntity]),
    ScriptsModule,
    WarmupModule,
    MessagingModule, // 2026-04-28 · Phase D · 取代 BaileysModule (entity + persistMessage)
    ChannelItemsModule,
    AssetsModule,
    CampaignsModule,
    SlotsModule, // R9-bis · ChatExecutor 注 SlotsService
  ],
  controllers: [TasksController],
  providers: [
    TasksService,
    DispatcherService,
    ExecutorRegistry,
    ChatExecutor,
    JoinGroupExecutor,
    StatusReactExecutor,
    AutoAcceptExecutor,
    StatusBrowseBulkExecutor,
    AutoReplyExecutor,
    AddContactExecutor,
    GroupChatExecutor,
    ProfileRefreshExecutor,
    SendVoiceExecutor,
    SendImageExecutor,
    SendVideoExecutor,
    {
      provide: TASK_EXECUTORS,
      useFactory: (
        chat: ChatExecutor,
        warmup: WarmupExecutor,
        scriptChat: ScriptChatExecutor,
        statusPost: StatusPostExecutor,
        statusBrowse: StatusBrowseExecutor,
        joinGroup: JoinGroupExecutor,
        statusReact: StatusReactExecutor,
        autoAccept: AutoAcceptExecutor,
        statusBrowseBulk: StatusBrowseBulkExecutor,
        autoReply: AutoReplyExecutor,
        addContact: AddContactExecutor,
        groupChat: GroupChatExecutor,
        profileRefresh: ProfileRefreshExecutor,
        sendVoice: SendVoiceExecutor,
        sendImage: SendImageExecutor,
        sendVideo: SendVideoExecutor,
        sendAd: SendAdExecutor,
      ) => [
        chat,
        warmup,
        scriptChat,
        statusPost,
        statusBrowse,
        joinGroup,
        statusReact,
        autoAccept,
        statusBrowseBulk,
        autoReply,
        addContact,
        groupChat,
        profileRefresh,
        sendVoice,
        sendImage,
        sendVideo,
        sendAd,
      ],
      inject: [
        ChatExecutor,
        WarmupExecutor,
        ScriptChatExecutor,
        StatusPostExecutor,
        StatusBrowseExecutor,
        JoinGroupExecutor,
        StatusReactExecutor,
        AutoAcceptExecutor,
        StatusBrowseBulkExecutor,
        AutoReplyExecutor,
        AddContactExecutor,
        GroupChatExecutor,
        ProfileRefreshExecutor,
        SendVoiceExecutor,
        SendImageExecutor,
        SendVideoExecutor,
        SendAdExecutor,
      ],
    },
  ],
  exports: [TasksService],
})
export class TasksModule {}
