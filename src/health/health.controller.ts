import {
  Controller,
  Get,
  Inject,
  ServiceUnavailableException,
} from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { HealthStatus } from '@brabo/shared';
import { DRIZZLE } from '../db/db.module';
import type { DrizzleDb } from '../db/db.module';

@Controller('health')
export class HealthController {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  @Get()
  async check(): Promise<HealthStatus> {
    try {
      await this.db.execute(sql`select 1`);
      return {
        service: 'api',
        status: 'ok',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      throw new ServiceUnavailableException({
        service: 'api',
        status: 'error',
        timestamp: new Date().toISOString(),
        details: { message: (error as Error).message },
      } satisfies HealthStatus);
    }
  }
}
