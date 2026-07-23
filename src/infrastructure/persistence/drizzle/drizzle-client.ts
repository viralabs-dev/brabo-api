import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../../../db/schema';

export type DrizzleDb = NodePgDatabase<typeof schema>;

export function createDrizzleClient(): { db: DrizzleDb; pool: Pool } {
  const pool = new Pool({
    connectionString:
      process.env.DATABASE_URL ?? 'postgres://brabo:brabo@localhost:5432/brabo',
  });
  return { db: drizzle(pool, { schema }), pool };
}

export const DRIZZLE = Symbol('DRIZZLE');
