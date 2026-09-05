import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";

const globalForDb = globalThis as unknown as {
  pool?: Pool;
};

function getPool() {
  if (globalForDb.pool) {
    return globalForDb.pool;
  }

  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set");
  }

  const pool = new Pool({ connectionString: databaseUrl });

  if (process.env.NODE_ENV !== "production") {
    globalForDb.pool = pool;
  }

  return pool;
}

export function getDb() {
  return drizzle(getPool(), { schema });
}