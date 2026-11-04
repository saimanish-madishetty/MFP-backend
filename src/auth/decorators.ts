import {
  SetMetadata,
  createParamDecorator,
  type ExecutionContext,
} from '@nestjs/common';
import type { UserRole } from '../generated/prisma/enums.js';

export const PUBLIC = 'auth:public';
export const ADMIN_ONLY = 'auth:admin-only';
export const ANY_ROLE = 'auth:any-role';

/** No login needed (health check, login itself). */
export const Public = () => SetMetadata(PUBLIC, true);
/** Admins only, even for reading (user management). */
export const AdminOnly = () => SetMetadata(ADMIN_ONLY, true);
/** A change any logged-in user may make (e.g. their own PIN), even view-only users. */
export const AnyRole = () => SetMetadata(ANY_ROLE, true);

export type AuthUser = {
  id: number;
  name: string;
  phone: string;
  role: UserRole;
};

/** The logged-in user (set by AuthGuard). */
export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthUser =>
    ctx.switchToHttp().getRequest<{ user: AuthUser }>().user,
);
