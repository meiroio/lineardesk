import process from "node:process"

import { drizzle } from "drizzle-orm/node-postgres"
import { Pool } from "pg"

import { readAppConfig } from "../config"
import { normalizeConnectionString } from "./connection"
import * as schema from "./schema"

let pool: Pool | null = null
let db: ReturnType<typeof drizzle<typeof schema>> | null = null

// Shared pg pool options for both Drizzle and Better Auth. The connection
// string pins TLS (verify-full) for cloud databases; on Vercel each serverless
// instance keeps a single connection and leans on the database's own pooler.
export function pgPoolConfig(connectionString: string) {
  return {
    connectionString: normalizeConnectionString(connectionString),
    max: process.env.VERCEL ? 1 : undefined,
  }
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
