import { ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    return super.canActivate(context);
  }

  handleRequest<T>(err: unknown, user: T, _info: unknown): T {
    if (err || !user) {
      throw err instanceof Error ? err : new UnauthorizedException('认证失败，请重新登录');
    }
    if ((user as { status?: string }).status && (user as { status?: string }).status !== 'active') {
      throw new UnauthorizedException('账号已被禁用，请联系管理员');
    }
    return user;
  }
}
