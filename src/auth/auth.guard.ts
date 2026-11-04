import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { UserRole } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ADMIN_ONLY, ANY_ROLE, PUBLIC, type AuthUser } from './decorators.js';
import { readToken } from './token.js';

/**
 * Runs on every request (registered as APP_GUARD):
 * - needs a valid login token unless the route is @Public();
 * - VIEWER users may only read (GET), except routes marked @AnyRole();
 * - @AdminOnly() routes need an ADMIN even to read.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly secret: string;

  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.secret = config.getOrThrow<string>('AUTH_SECRET');
    if (this.secret.length < 32)
      throw new Error('AUTH_SECRET must be at least 32 characters');
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const flag = (key: string) =>
      this.reflector.getAllAndOverride<boolean>(key, [
        ctx.getHandler(),
        ctx.getClass(),
      ]) ?? false;
    if (flag(PUBLIC)) return true;

    const req = ctx.switchToHttp().getRequest<{
      method: string;
      headers: Record<string, string | undefined>;
      user?: AuthUser;
    }>();
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const payload = readToken(token, this.secret);
    if (!payload) throw new UnauthorizedException('Please log in');

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });
    if (!user || !user.active || user.tokenVersion !== payload.v)
      throw new UnauthorizedException(
        'Your login has ended. Please log in again.',
      );
    req.user = {
      id: user.id,
      name: user.name,
      phone: user.phone,
      role: user.role,
    };

    const admin = user.role === UserRole.ADMIN;
    if (flag(ADMIN_ONLY) && !admin)
      throw new ForbiddenException('Only an admin can do this');
    if (req.method !== 'GET' && !admin && !flag(ANY_ROLE))
      throw new ForbiddenException(
        'You have view-only access. Ask an admin to make changes.',
      );
    return true;
  }
}
