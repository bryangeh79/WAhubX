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

@Module({
  imports: [
    TypeOrmModule.forFeature([TaskEntity, TaskRunEntity]),
    ScriptsModule, // 提供 ScriptChatExecutor
    WarmupModule, // 提供 WarmupExecutor / StatusPostExecutor / StatusBrowseExecutor
  ],
  controllers: [TasksController],
  providers: [
    TasksService,
    DispatcherService,
    ExecutorRegistry,
    ChatExecutor,
    // 加新 type 在此 providers 加 class (或从其他 module 导入), 然后下方 factory 加入 array
    {
      provide: TASK_EXECUTORS,
      useFactory: (
        chat: ChatExecutor,
        warmup: WarmupExecutor,
        scriptChat: ScriptChatExecutor,
        statusPost: StatusPostExecutor,
        statusBrowse: StatusBrowseExecutor,
      ) => [chat, warmup, scriptChat, statusPost, statusBrowse],
      inject: [ChatExecutor, WarmupExecutor, ScriptChatExecutor, StatusPostExecutor, StatusBrowseExecutor],
    },
  ],
  exports: [TasksService],
})
export class TasksModule {}
