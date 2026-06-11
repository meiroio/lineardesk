import process from "node:process"

import { drizzle } from "drizzle-orm/node-postgres"
import { Pool } from "pg"

import { readAppConfig } from "../config"
import * as schema from "./schema"

let pool: Pool | null = null
let db: ReturnType<typeof drizzle<typeof schema>> | null = null

// Shared pg pool options for both Drizzle and Better Auth. Cloud Postgres
// (Neon, etc.) needs TLS; on Vercel each serverless instance keeps a single
// connection and leans on the database's own connection pooler.
export function pgPoolConfig(connectionString: string) {
  const isLocal = /localhost|127\.0\.0\.1/.test(connectionString)
  return {
    connectionString,
    ssl: isLocal ? undefined : { rejectUnauthorized: true },
    max: process.env.VERCEL ? 1 : undefined,
  }
}

export function createDb(databaseUrl: string) {
  const localPool = new Pool(pgPoolConfig(databaseUrl))
  return drizzle(localPool, { schema })
}

export function getDb() {
  if (!db) {
    pool = new Pool(pgPoolConfig(readAppConfig().databaseUrl))
    db = drizzle(pool, { schema })
  }

  return db
}

export async function closeDb() {
  await pool?.end()
  pool = null
  db = null
}
