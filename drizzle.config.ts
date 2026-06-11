import process from "node:process"
import { existsSync, readFileSync } from "node:fs"

import { defineConfig } from "drizzle-kit"

import { normalizeConnectionString } from "./src/server/db/connection"

loadLocalEnv()

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

function loadLocalEnv() {
  for (const file of [".env.local", ".env"]) {
    if (!existsSync(file)) continue

    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith("#")) continue

      const equalsIndex = trimmed.indexOf("=")
      if (equalsIndex <= 0) continue

      const key = trimmed.slice(0, equalsIndex)
      if (process.env[key]) continue

      process.env[key] = trimmed.slice(equalsIndex + 1)
    }
  }
}
