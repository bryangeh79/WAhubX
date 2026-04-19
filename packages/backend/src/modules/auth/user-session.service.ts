import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThan, Repository } from 'typeorm';
import { UserSession } from './user-session.entity';
import type { CreateSessionParams } from './dto/create-session.dto';

@Injectable()
export class UserSessionService {
  constructor(
    @InjectRepository(UserSession)
    private readonly repo: Repository<UserSession>,
    private readonly config: ConfigService,
  ) {}

  async createSession(params: CreateSessionParams): Promise<UserSession> {
    const session = this.repo.create({
      userId: params.userId,
      accessToken: params.accessToken,
      refreshToken: params.refreshToken,
      deviceInfo: params.deviceInfo ?? null,
      userAgent: params.userAgent ?? null,
      ipAddress: params.ipAddress ?? null,
      expiresAt: this.calculateExpiry('refresh'),
      revoked: false,
      revokedAt: null,
    });
    return this.repo.save(session);
  }

  async validateSession(userId: string, refreshToken: string): Promise<UserSession | null> {
    return this.repo.findOne({
      where: {
        userId,
        refreshToken,
        revoked: false,
        expiresAt: MoreThan(new Date()),
      },
    });
  }

  async validateAccessToken(userId: string, accessToken: string): Promise<boolean> {
    const hit = await this.repo.findOne({
      where: {
        userId,
        accessToken,
        revoked: false,
        expiresAt: MoreThan(new Date()),
      },
    });
    return !!hit;
  }

  async updateAccessToken(
    sessionId: string,
    newAccessToken: string,
    newRefreshToken?: string,
  ): Promise<UserSession> {
    const session = await this.repo.findOne({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('会话不存在');

    session.accessToken = newAccessToken;
    if (newRefreshToken) session.refreshToken = newRefreshToken;
    session.expiresAt = this.calculateExpiry('refresh');
    return this.repo.save(session);
  }

  async revokeSession(userId: string, accessToken: string): Promise<void> {
    const session = await this.repo.findOne({
      where: { userId, accessToken, revoked: false },
    });
    if (!session) return;
    session.revoked = true;
    session.revokedAt = new Date();
    await this.repo.save(session);
  }

  async revokeAllSessions(userId: string): Promise<void> {
    await this.repo.update(
      { userId, revoked: false },
      { revoked: true, revokedAt: new Date() },
    );
  }

  async revokeSessionById(userId: string, sessionId: string): Promise<void> {
    const session = await this.repo.findOne({ where: { id: sessionId, userId } });
    if (!session) throw new NotFoundException('会话不存在');
    session.revoked = true;
    session.revokedAt = new Date();
    await this.repo.save(session);
  }

  async getUserSessions(userId: string): Promise<UserSession[]> {
    return this.repo.find({
      where: { userId, revoked: false },
      order: { createdAt: 'DESC' },
    });
  }

  async cleanupExpiredSessions(): Promise<number> {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const res = await this.repo
      .createQueryBuilder()
      .delete()
      .where('expires_at < :now', { now })
      .orWhere('revoked = true AND revoked_at < :cutoff', { cutoff: thirtyDaysAgo })
      .execute();
    return res.affected ?? 0;
  }

  private calculateExpiry(which: 'access' | 'refresh'): Date {
    const raw = which === 'access'
      ? this.config.get<string>('JWT_ACCESS_TTL', '15m')
      : this.config.get<string>('JWT_REFRESH_TTL', '7d');
    return new Date(Date.now() + this.parseDuration(raw));
  }

  private parseDuration(expr: string): number {
    const match = expr.match(/^(\d+)(s|m|h|d)?$/);
    if (!match) return 7 * 24 * 60 * 60 * 1000;
    const value = Number.parseInt(match[1], 10);
    const unit = match[2] ?? 's';
    const mult: Record<string, number> = {
      s: 1000,
      m: 60_000,
      h: 3_600_000,
      d: 86_400_000,
    };
    return value * (mult[unit] ?? 1000);
  }
}
