import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayNotEmpty,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { TaskTargetType } from '../task.entity';

export class CreateTaskDto {
  @IsString()
  @IsNotEmpty({ message: 'task_type 不能为空' })
  @MaxLength(64)
  taskType!: string;

  @IsEnum(TaskTargetType)
  targetType!: TaskTargetType;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMinSize(1)
  @IsInt({ each: true })
  targetIds!: number[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(9)
  priority?: number;

  @IsOptional()
  @IsDateString()
  scheduledAt?: string;

  @IsOptional()
  @IsString()
  repeatRule?: string;

  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;
}
