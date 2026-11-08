import {
  Controller,
  Get,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Public } from '../auth/decorators.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Controller('health')
export class HealthController {
  private readonly logger = new Logger('Health');

  constructor(private readonly prisma: PrismaService) {}

  // Unauthenticated; pinged by UptimeRobot. Touching the DB also keeps Supabase from pausing.
  // `commit` (set by Render) lets the deploy script see when the new version is live.
  @Public()
  @Get()
  async check() {
    const commit = process.env.RENDER_GIT_COMMIT ?? null;
    try {
      // A database that doesn't answer within 5 s counts as down, so /health always replies.
      await Promise.race([
        this.prisma.$queryRaw`SELECT 1`,
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error('Database did not answer within 5 s')),
            5_000,
          ),
        ),
      ]);
    } catch (err) {
      this.logger.error(
        `Health check: database down: ${(err as Error).message}`,
      );
      throw new ServiceUnavailableException({
        status: 'error',
        db: 'down',
        commit,
      });
    }
    return { status: 'ok', db: 'up', commit };
  }
}
