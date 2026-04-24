import { Controller, Get, Query } from '@nestjs/common';
import {
  STATUS_POST_SEEDS,
  listSeedTags,
  pickStatusPostSeed,
  type StatusPostSeed,
} from '../../data/status-post-seeds';

// 2026-04-22 · Status Post 文案种子库 · 前端 Scheduler 选 tag 用
@Controller({ path: 'status-post-seeds', version: '1' })
export class StatusPostSeedsController {
  @Get()
  list(@Query('tag') tag?: string): StatusPostSeed[] {
    if (!tag) return STATUS_POST_SEEDS;
    return STATUS_POST_SEEDS.filter((s) => s.tags.includes(tag));
  }

  @Get('tags')
  tags() {
    return listSeedTags();
  }

  @Get('random')
  random(
    @Query('tags') tagsCsv?: string,
    @Query('language') language?: 'zh' | 'en' | 'ms',
  ) {
    const tags = tagsCsv ? tagsCsv.split(',').filter(Boolean) : undefined;
    return pickStatusPostSeed({ tags, language });
  }
}
