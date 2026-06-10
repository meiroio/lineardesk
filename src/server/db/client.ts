import { drizzle } from "drizzle-orm/node-postgres"
import { Pool } from "pg"

import { readAppConfig } from "../config"
import * as schema from "./schema"

let pool: Pool | null = null
let db: ReturnType<typeof drizzle<typeof schema>> | null = null

export function createDb(databaseUrl: string) {
  const localPool = new Pool({ connectionString: databaseUrl })
  return drizzle(localPool, { schema })
}

export function getDb() {
  if (!db) {
    pool = new Pool({ connectionString: readAppConfig().databaseUrl })
    db = drizzle(pool, { schema })
  }

  return db
}

export async function closeDb() {
  await pool?.end()
  pool = null
  db = null
}
