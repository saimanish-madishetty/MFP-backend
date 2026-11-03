import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  // Unauthenticated; pinged by UptimeRobot. Touching the DB also keeps Supabase from pausing.
  // `commit` (set by Render) lets the deploy script see when the new version is live.
  @Get()
  async check() {
    const commit = process.env.RENDER_GIT_COMMIT ?? null;
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException({ status: 'error', db: 'down', commit });
    }
    return { status: 'ok', db: 'up', commit };
  }
}
