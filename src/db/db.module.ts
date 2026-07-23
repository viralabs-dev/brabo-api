import { Global, Module, OnModuleDestroy } from '@nestjs/common';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export const DRIZZLE = Symbol('DRIZZLE');
export type DrizzleDb = NodePgDatabase<typeof schema>;

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ?? 'postgres://brabo:brabo@localhost:5432/brabo',
});

@Global()
@Module({
  providers: [
    {
      provide: DRIZZLE,
      useValue: drizzle(pool, { schema }),
    },
  ],
  exports: [DRIZZLE],
})
export class DbModule implements OnModuleDestroy {
  async onModuleDestroy() {
    await pool.end();
  }
}
