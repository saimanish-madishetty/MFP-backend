import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthUser } from './decorators.js';
import {
  ChangePinDto,
  CreateUserDto,
  LoginDto,
  UpdateUserDto,
} from './dto/auth.dto.js';
import { normalizePhone } from './phone.js';
import { hashPin, verifyPin } from './pin.js';
import { issueToken } from './token.js';

/** Wrong PINs in a row before the account is locked, and for how long. */
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
/** Compared against when the number is unknown, so the reply takes the same time. */
const DUMMY_HASH = `scrypt$${'0'.repeat(32)}$${'0'.repeat(64)}`;

const PUBLIC_FIELDS = {
  id: true,
  name: true,
  phone: true,
  role: true,
  active: true,
  lastLoginAt: true,
  createdAt: true,
} as const;

@Injectable()
export class AuthService {
  private readonly secret: string;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.secret = config.getOrThrow<string>('AUTH_SECRET');
  }

  async login(dto: LoginDto) {
    const wrong = new UnauthorizedException('Wrong mobile number or PIN');
    const phone = normalizePhone(dto.phone);
    const user = phone
      ? await this.prisma.user.findUnique({ where: { phone } })
      : null;
    if (!user || !user.active) {
      await verifyPin(dto.pin, DUMMY_HASH);
      throw wrong;
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const mins = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
      throw new HttpException(
        `Too many wrong PINs. Try again in ${mins} minute${mins === 1 ? '' : 's'}, or ask an admin to reset your PIN.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (!(await verifyPin(dto.pin, user.pinHash))) {
      const failed = user.failedLogins + 1;
      await this.prisma.user.update({
        where: { id: user.id },
        data:
          failed >= MAX_FAILED
            ? {
                failedLogins: 0,
                lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60000),
              }
            : { failedLogins: failed },
      });
      throw wrong;
    }
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() },
      select: PUBLIC_FIELDS,
    });
    return {
      token: issueToken(user.id, user.tokenVersion, this.secret),
      user: updated,
    };
  }

  /** Changes your own PIN. Other devices are logged out; this one gets a new token. */
  async changePin(me: AuthUser, dto: ChangePinDto) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: me.id },
    });
    if (!(await verifyPin(dto.currentPin, user.pinHash)))
      throw new BadRequestException('Current PIN is wrong');
    const updated = await this.prisma.user.update({
      where: { id: me.id },
      data: {
        pinHash: await hashPin(dto.newPin),
        tokenVersion: { increment: 1 },
      },
    });
    return { token: issueToken(updated.id, updated.tokenVersion, this.secret) };
  }

  // ── User management (admins) ──────────────────────────────

  listUsers() {
    return this.prisma.user.findMany({
      select: { ...PUBLIC_FIELDS, lockedUntil: true },
      orderBy: [{ active: 'desc' }, { role: 'asc' }, { name: 'asc' }],
    });
  }

  async createUser(dto: CreateUserDto) {
    const phone = await this.freePhone(dto.phone);
    return this.prisma.user.create({
      data: {
        name: dto.name.trim(),
        phone,
        role: dto.role,
        pinHash: await hashPin(dto.pin),
      },
      select: PUBLIC_FIELDS,
    });
  }

  async updateUser(me: AuthUser, id: number, dto: UpdateUserDto) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    const losesAdmin =
      user.role === UserRole.ADMIN &&
      ((dto.role !== undefined && dto.role !== UserRole.ADMIN) ||
        dto.active === false);
    if (losesAdmin) await this.keepAnAdmin(me, id);

    const endLogins =
      dto.pin !== undefined ||
      dto.active === false ||
      (dto.role !== undefined && dto.role !== user.role);
    return this.prisma.user.update({
      where: { id },
      data: {
        name: dto.name?.trim(),
        phone:
          dto.phone !== undefined
            ? await this.freePhone(dto.phone, id)
            : undefined,
        role: dto.role,
        active: dto.active,
        ...(dto.pin !== undefined && {
          pinHash: await hashPin(dto.pin),
          failedLogins: 0,
          lockedUntil: null,
        }),
        ...(endLogins && { tokenVersion: { increment: 1 } }),
      },
      select: PUBLIC_FIELDS,
    });
  }

  async deleteUser(me: AuthUser, id: number) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    if (user.role === UserRole.ADMIN) await this.keepAnAdmin(me, id);
    await this.prisma.user.delete({ where: { id } });
  }

  /** Stops admins locking everyone out: not yourself, not the last active admin. */
  private async keepAnAdmin(me: AuthUser, id: number) {
    if (me.id === id)
      throw new BadRequestException(
        "You can't remove your own admin access. Ask another admin.",
      );
    const others = await this.prisma.user.count({
      where: { role: UserRole.ADMIN, active: true, id: { not: id } },
    });
    if (others === 0)
      throw new BadRequestException('There must be at least one active admin');
  }

  private async freePhone(input: string, exceptId?: number) {
    const phone = normalizePhone(input);
    if (!phone)
      throw new BadRequestException(
        'Enter a 10-digit mobile number (starting 6-9)',
      );
    const taken = await this.prisma.user.findUnique({ where: { phone } });
    if (taken && taken.id !== exceptId)
      throw new ConflictException(`${phone} is already used by ${taken.name}`);
    return phone;
  }
}
