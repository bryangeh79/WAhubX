import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { Request } from 'express';
import { UserSessionService } from '../user-session.service';

export interface JwtPayload {
  sub: string;
  email: string;
  username: string;
  role: string;
  tenantId: number | null;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly sessions: UserSessionService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      passReqToCallback: true,
    });
  }

  async validate(req: Request, payload: JwtPayload) {
    const rawToken = ExtractJwt.fromAuthHeaderAsBearerToken()(req);
    if (!rawToken) throw new UnauthorizedException('缺少访问令牌');

    const valid = await this.sessions.validateAccessToken(payload.sub, rawToken);
    if (!valid) throw new UnauthorizedException('令牌已失效，请重新登录');

    return {
      id: payload.sub,
      email: payload.email,
      username: payload.username,
      role: payload.role,
      tenantId: payload.tenantId,
      status: 'active',
    };
  }
}
