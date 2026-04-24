import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  AdStrategy,
  CampaignSchedule,
  CampaignTargets,
  ExecutionMode,
  OpeningStrategy,
  ThrottleProfile,
} from '../entities/campaign.entity';

// 不用 class-validator 深度校验 schedule / targets · schema 太灵活 · service 层做运行时校验
export class CreateCampaignDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  name!: string;

  // schedule: {mode, ...} · 由 service 层深度校验
  @IsObject()
  @IsNotEmpty()
  schedule!: CampaignSchedule;

  // targets: {groupIds, extraPhones}
  @IsObject()
  @IsNotEmpty()
  targets!: CampaignTargets;

  @IsEnum(AdStrategy)
  adStrategy!: AdStrategy;

  @IsArray()
  @ArrayMinSize(1, { message: '至少选择 1 条广告' })
  @IsInt({ each: true })
  adIds!: number[];

  @IsEnum(OpeningStrategy)
  openingStrategy!: OpeningStrategy;

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  openingIds?: number[];

  @IsEnum(ExecutionMode)
  executionMode!: ExecutionMode;

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  customSlotIds?: number[];

  @IsOptional()
  @IsEnum(ThrottleProfile)
  throttleProfile?: ThrottleProfile;

  // 创建时是否立即启动 · false = 存 draft
  @IsOptional()
  @IsBoolean()
  startNow?: boolean;
}

export class PreviewSafetyDto {
  @IsObject()
  @IsNotEmpty()
  schedule!: CampaignSchedule;

  @IsObject()
  @IsNotEmpty()
  targets!: CampaignTargets;

  @IsEnum(ExecutionMode)
  executionMode!: ExecutionMode;

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  customSlotIds?: number[];

  @IsOptional()
  @IsEnum(ThrottleProfile)
  throttleProfile?: ThrottleProfile;
}

export class UpdateCampaignDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  name?: string;
}
