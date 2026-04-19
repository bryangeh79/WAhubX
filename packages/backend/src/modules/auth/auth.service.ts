import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import { User, UserStatus } from '../users/user.entity';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import type { TokenResponseDto, AuthenticatedUserSummary } from './dto/token-response.dto';
import type { JwtPayload } from './strategies/jwt.strategy';
import { UserSessionService } from './user-session.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly sessions: UserSessionService,
  ) {}

  async hasUsers(): Promise<boolean> {
    return (await this.users.count()) > 0;
  }

  async login(dto: LoginDto): Promise<TokenResponseDto> {
    // 通用口径: 为避免用户枚举攻击, 用户不存在/密码错误返回同一错误
    const GENERIC_CRED_ERROR = '邮箱或密码错误';

    const user = await this.users.findByEmail(dto.email);
    if (!user) throw new UnauthorizedException(GENERIC_CRED_ERROR);

    if (this.users.isLocked(user)) {
      throw new UnauthorizedException(
        `账号已锁定, 请 ${this.formatRemainingLock(user.lockedUntil)} 后重试`,
      );
    }

    const ok = await this.users.validatePassword(user, dto.password);
    if (!ok) {
      await this.users.registerFailedLogin(user.id);
      throw new UnauthorizedException(GENERIC_CRED_ERROR);
    }

    if (user.status !== UserStatus.Active) {
      throw new UnauthorizedException('账号已被禁用，请联系管理员');
    }

    await this.users.resetFailedLogin(user.id);
    await this.users.updateLoginStats(user.id);

    const tokens = await this.issueTokens(user);
    await this.sessions.createSession({
      userId: user.id,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      deviceInfo: dto.deviceInfo ?? null,
      userAgent: dto.userAgent ?? null,
      ipAddress: dto.ipAddress ?? null,
    });
    return tokens;
  }

  async refreshToken(dto: RefreshTokenDto): Promise<TokenResponseDto> {
    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(dto.refreshToken, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });
    } catch (err) {
      const name = (err as { name?: string }).name;
      if (name === 'TokenExpiredError') throw new UnauthorizedException('刷新令牌已过期，请重新登录');
      if (name === 'JsonWebTokenError') throw new UnauthorizedException('无效的刷新令牌');
      throw err;
    }

    const user = await this.users.findOne(payload.sub);
    if (user.status !== UserStatus.Active) {
      throw new UnauthorizedException('账号已被禁用，请联系管理员');
    }

    const session = await this.sessions.validateSession(user.id, dto.refreshToken);
    if (!session) throw new UnauthorizedException('会话已失效，请重新登录');

    const tokens = await this.issueTokens(user);
    await this.sessions.updateAccessToken(session.id, tokens.accessToken, tokens.refreshToken);
    return tokens;
  }

  async logout(userId: string, accessToken: string): Promise<void> {
    await this.sessions.revokeSession(userId, accessToken);
  }

  async logoutAll(userId: string): Promise<void> {
    await this.sessions.revokeAllSessions(userId);
  }

  async getUserSessions(userId: string) {
    return this.sessions.getUserSessions(userId);
  }

  async revokeSession(userId: string, sessionId: string): Promise<void> {
    await this.sessions.revokeSessionById(userId, sessionId);
  }

  async changePassword(userId: string, current: string, next: string): Promise<void> {
    const user = await this.users.findOne(userId);
    const ok = await this.users.validatePassword(user, current);
    if (!ok) throw new BadRequestException('当前密码错误');
    await this.users.updatePassword(userId, next);
    await this.sessions.revokeAllSessions(userId);
  }

  private async issueTokens(user: User): Promise<TokenResponseDto> {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
      tenantId: user.tenantId,
    };
    const accessTtl = this.config.get<string>('JWT_ACCESS_TTL', '15m');
    const refreshTtl = this.config.get<string>('JWT_REFRESH_TTL', '7d');

    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(payload, {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        // @nestjs/jwt v11 类型是 ms.StringValue 模板字面量, 从动态 env 读需要断言
        expiresIn: accessTtl as unknown as number,
      }),
      this.jwt.signAsync(payload, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
        expiresIn: refreshTtl as unknown as number,
      }),
    ]);

    const userSummary: AuthenticatedUserSummary = {
      id: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
      tenantId: user.tenantId,
      fullName: user.fullName,
      avatarUrl: user.avatarUrl,
    };

    return {
      accessToken,
      refreshToken,
      expiresIn: accessTtl,
      tokenType: 'Bearer',
      user: userSummary,
    };
  }

  private formatRemainingLock(lockedUntil: Date | null): string {
    if (!lockedUntil) return '稍后';
    const sec = Math.max(0, Math.ceil((lockedUntil.getTime() - Date.now()) / 1000));
    const min = Math.floor(sec / 60);
    if (min >= 1) return `${min} 分钟`;
    return `${sec} 秒`;
  }
}
