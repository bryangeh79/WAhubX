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

@Module({
  imports: [TypeOrmModule.forFeature([TaskEntity, TaskRunEntity])],
  controllers: [TasksController],
  providers: [
    TasksService,
    DispatcherService,
    ExecutorRegistry,
    ChatExecutor,
    WarmupExecutor,
    // 用 symbol token 汇集所有 executor; 加新 type 只需在此 providers 数组加 class + token useFactory
    {
      provide: TASK_EXECUTORS,
      useFactory: (chat: ChatExecutor, warmup: WarmupExecutor) => [chat, warmup],
      inject: [ChatExecutor, WarmupExecutor],
    },
  ],
  exports: [TasksService],
})
export class TasksModule {}
