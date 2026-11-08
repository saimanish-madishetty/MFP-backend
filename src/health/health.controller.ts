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
      this.failures++;
      this.logger.error(
        `Health check: database down (${this.failures} in a row): ${(err as Error).message}`,
      );
      // Last resort: if the database connections are stuck, only a fresh process clears them.
      // On Render, exiting makes it start a new one (what a manual deploy did by hand).
      if (this.failures >= RESTART_AFTER && process.env.RENDER) {
        this.logger.error(
          `Restarting: ${RESTART_AFTER} failed health checks in a row`,
        );
        setTimeout(() => process.exit(1), 500);
      }
      throw new ServiceUnavailableException({
        status: 'error',
        db: 'down',
        commit,
      });
    }
    this.failures = 0;
    return { status: 'ok', db: 'up', commit };
  }

  /** Failed checks in a row; UptimeRobot checks every few minutes. */
  private failures = 0;
}

/** Failed health checks in a row before the backend restarts itself (on Render only). */
const RESTART_AFTER = 3;
