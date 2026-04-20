// M9 · Takeover Module 装配
//
// 依赖:
//   - AccountSlotEntity (读 takeover_active + slot 属性)
//   - TaskEntity / TaskRunEntity (pause/resume/interrupt 状态迁移)
//   - BaileysService (send-text / send-media / listContacts / listMessages)
//   - AuthModule (JWT + Roles)
//   - AccountHealthModule (AlertDispatcher, @Global export)
//
// 注: Gateway 用 socket.io, 全局 JwtAuthGuard (在 app.module.ts 注册的 APP_GUARD) 仅对 HTTP
// 路由生效, WS handshake 手动校验 token (见 TakeoverGateway.handleConnection).

import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountSlotEntity } from '../slots/account-slot.entity';
import { TaskEntity } from '../tasks/task.entity';
import { TaskRunEntity } from '../tasks/task-run.entity';
import { ChatMessageEntity } from '../baileys/chat-message.entity';
import { WaContactEntity } from '../baileys/wa-contact.entity';
import { AuthModule } from '../auth/auth.module';
import { BaileysModule } from '../baileys/baileys.module';
import { TakeoverLockService } from './takeover-lock.service';
import { TakeoverUploadService } from './takeover-upload.service';
import { TakeoverController } from './takeover.controller';
import { ChatsController } from './chats.controller';
import { TakeoverGateway } from './takeover.gateway';
import { TakeoverAlertRelay } from './takeover-alert.relay';

// @Global · 让 DispatcherService (TasksModule) optional inject TakeoverLockService 不需反向 import
@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([AccountSlotEntity, TaskEntity, TaskRunEntity, ChatMessageEntity, WaContactEntity]),
    AuthModule,
    BaileysModule,
  ],
  controllers: [TakeoverController, ChatsController],
  providers: [TakeoverLockService, TakeoverUploadService, TakeoverGateway, TakeoverAlertRelay],
  exports: [TakeoverLockService],
})
export class TakeoverModule {}
