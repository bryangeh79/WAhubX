import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

// AI provider 配置 · §4.9 + §B.4
// M6 支持 openai / deepseek / custom_openai_compat (统一 OpenAI-兼容 client)
// gemini / claude 保留 adapter skeleton, M6 收工不验, 未实装就是 NotImplemented
// key 存密文 (AES-256-GCM · master key 来自 MasterKeyProvider)
export enum AiProviderType {
  OpenAI = 'openai',
  DeepSeek = 'deepseek',
  CustomOpenAICompat = 'custom_openai_compat', // Ollama / SiliconFlow / Azure / OpenRouter 等
  Gemini = 'gemini',
  Claude = 'claude',
}

@Entity('ai_provider')
@Index('idx_ai_provider_type', ['providerType'])
@Index('idx_ai_provider_enabled', ['enabled'])
export class AiProviderEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'enum', enum: AiProviderType, name: 'provider_type' })
  providerType!: AiProviderType;

  // 用户可自定义显示名 (同 type 可建多条, 如 "openai-gpt4" 和 "openai-gpt4o-mini")
  @Column({ type: 'text' })
  name!: string;

  // 模型 id e.g. gpt-4o-mini / deepseek-chat / claude-haiku
  @Column({ type: 'text' })
  model!: string;

  // OpenAI 兼容: e.g. https://api.openai.com/v1 / https://api.deepseek.com/v1 / ollama http://localhost:11434/v1
  @Column({ type: 'text', name: 'base_url' })
  baseUrl!: string;

  // AES-256-GCM 密文 · format: "gcm:v1:{iv_hex}:{ciphertext_hex}:{authtag_hex}"
  @Column({ type: 'text', name: 'api_key_encrypted' })
  apiKeyEncrypted!: string;

  @Column({ type: 'boolean', default: true })
  enabled!: boolean;

  // 连通性测试元数据
  @Column({ type: 'timestamptz', name: 'last_tested_at', nullable: true })
  lastTestedAt!: Date | null;

  @Column({ type: 'boolean', name: 'last_test_ok', nullable: true })
  lastTestOk!: boolean | null;

  @Column({ type: 'text', name: 'last_test_error', nullable: true })
  lastTestError!: string | null;

  // 请求参数默认值 (供 UI 展示 / 覆盖); 具体字段透传, 保 provider 扩展灵活
  @Column({ type: 'jsonb', name: 'default_params', nullable: true })
  defaultParams!: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
