import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiProviderEntity, AiProviderType } from './ai-provider.entity';
import { AiEncryptionService } from './ai-encryption.service';

export interface CreateProviderDto {
  providerType: AiProviderType;
  name: string;
  model: string;
  baseUrl: string;
  apiKey: string; // 明文 · 立即加密后落 DB
  enabled?: boolean;
  defaultParams?: Record<string, unknown>;
}

export interface UpdateProviderDto {
  name?: string;
  model?: string;
  baseUrl?: string;
  apiKey?: string; // 仅提供时重加密, 不提供不动
  enabled?: boolean;
  defaultParams?: Record<string, unknown> | null;
}

// 输出 DTO (隐 key 密文, 脱敏显示)
export interface ProviderDTO {
  id: number;
  providerType: AiProviderType;
  name: string;
  model: string;
  baseUrl: string;
  apiKeyMasked: string; // e.g. "sk-a***xyz" — 仅给 UI 显示, 不用于解密
  enabled: boolean;
  lastTestedAt: Date | null;
  lastTestOk: boolean | null;
  lastTestError: string | null;
  defaultParams: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class AiProvidersService {
  constructor(
    @InjectRepository(AiProviderEntity) private readonly repo: Repository<AiProviderEntity>,
    private readonly encryption: AiEncryptionService,
  ) {}

  async list(): Promise<ProviderDTO[]> {
    const rows = await this.repo.find({ order: { id: 'ASC' } });
    return rows.map((r) => this.toDTO(r));
  }

  async create(dto: CreateProviderDto): Promise<ProviderDTO> {
    if (!dto.apiKey || dto.apiKey.length < 4) {
      throw new BadRequestException('apiKey 必填且长度 >= 4');
    }
    if (!Object.values(AiProviderType).includes(dto.providerType)) {
      throw new BadRequestException(`providerType 需 ${Object.values(AiProviderType).join('|')}`);
    }
    const enc = this.encryption.encrypt(dto.apiKey);
    const entity = this.repo.create({
      providerType: dto.providerType,
      name: dto.name,
      model: dto.model,
      baseUrl: dto.baseUrl,
      apiKeyEncrypted: enc,
      enabled: dto.enabled ?? true,
      defaultParams: dto.defaultParams ?? null,
    });
    const saved = await this.repo.save(entity);
    return this.toDTO(saved);
  }

  async update(id: number, dto: UpdateProviderDto): Promise<ProviderDTO> {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException(`ai_provider ${id} 不存在`);
    if (dto.name !== undefined) row.name = dto.name;
    if (dto.model !== undefined) row.model = dto.model;
    if (dto.baseUrl !== undefined) row.baseUrl = dto.baseUrl;
    if (dto.enabled !== undefined) row.enabled = dto.enabled;
    if (dto.defaultParams !== undefined) row.defaultParams = dto.defaultParams;
    if (dto.apiKey !== undefined && dto.apiKey.length >= 4) {
      row.apiKeyEncrypted = this.encryption.encrypt(dto.apiKey);
    }
    return this.toDTO(await this.repo.save(row));
  }

  async remove(id: number): Promise<void> {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException(`ai_provider ${id} 不存在`);
    await this.repo.remove(row);
  }

  async findOne(id: number): Promise<ProviderDTO> {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException(`ai_provider ${id} 不存在`);
    return this.toDTO(row);
  }

  private toDTO(e: AiProviderEntity): ProviderDTO {
    let apiKeyMasked = '';
    try {
      const plain = this.encryption.decrypt(e.apiKeyEncrypted);
      apiKeyMasked = this.encryption.maskKey(plain);
    } catch {
      apiKeyMasked = '(decrypt-failed)';
    }
    return {
      id: e.id,
      providerType: e.providerType,
      name: e.name,
      model: e.model,
      baseUrl: e.baseUrl,
      apiKeyMasked,
      enabled: e.enabled,
      lastTestedAt: e.lastTestedAt,
      lastTestOk: e.lastTestOk,
      lastTestError: e.lastTestError,
      defaultParams: e.defaultParams,
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
    };
  }
}
