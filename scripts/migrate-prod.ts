/**
 * Apply Drizzle migrations to a remote (Neon) database using its DIRECT
 * (unpooled) connection.
 *
 * `drizzle-kit migrate` fails through Neon's pooled (PgBouncer) endpoint, so
 * this wrapper insists on DATABASE_URL_UNPOOLED and runs the migration with it
 * as DATABASE_URL. Refusing to fall back to a pooled/localhost URL avoids two
 * traps: migrating the wrong database, and a confusing PgBouncer failure.
 *
 * Run this BEFORE (or together with) any deploy that changes the schema —
 * Vercel's build does not run migrations.
 *
 *   bun run db:migrate:prod        # uses DATABASE_URL_UNPOOLED from the env
 */
import { spawnSync } from "node:child_process"
import process from "node:process"

const url = process.env.DATABASE_URL_UNPOOLED?.trim()
if (!url) {
  console.error(
    "DATABASE_URL_UNPOOLED is not set. Point it at the Neon DIRECT (unpooled) " +
      "connection string — pooled URLs fail drizzle-kit migrate."
  )
  process.exit(1)
}

const result = spawnSync("bun", ["x", "drizzle-kit", "migrate"], {
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: url },
})

process.exit(result.status ?? 1)
