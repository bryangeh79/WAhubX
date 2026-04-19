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
import { WarmupExecutor } from './executors/warmup.executor';
import { ScriptsModule } from '../scripts/scripts.module';
import { ScriptChatExecutor } from '../scripts/script-chat.executor';

@Module({
  imports: [TypeOrmModule.forFeature([TaskEntity, TaskRunEntity]), ScriptsModule],
  controllers: [TasksController],
  providers: [
    TasksService,
    DispatcherService,
    ExecutorRegistry,
    ChatExecutor,
    WarmupExecutor,
    // 加新 type 在此 providers 加 class, 然后下方 factory 加入 array
    {
      provide: TASK_EXECUTORS,
      useFactory: (chat: ChatExecutor, warmup: WarmupExecutor, scriptChat: ScriptChatExecutor) => [
        chat,
        warmup,
        scriptChat,
      ],
      inject: [ChatExecutor, WarmupExecutor, ScriptChatExecutor],
    },
  ],
  exports: [TasksService],
})
export class TasksModule {}
