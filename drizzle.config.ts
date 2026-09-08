import process from "node:process"

import { defineConfig } from "drizzle-kit"

import { normalizeConnectionString } from "./src/server/db/connection"

export default defineConfig({
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: normalizeConnectionString(
      process.env.DATABASE_URL ??
        "postgres://lineardesk:lineardesk@localhost:5433/lineardesk"
    ),
  },
})
