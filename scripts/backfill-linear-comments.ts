import { existsSync, readFileSync } from "node:fs"
import process from "node:process"

import { backfillMissingDetailsComments } from "../src/server/comment-backfill"
import { readAppConfig } from "../src/server/config"
import { closeDb } from "../src/server/db/client"
import { createLinearGateway } from "../src/server/linear"
import { createHelpdeskRepository } from "../src/server/repository"

loadLocalEnv()

const limit = readLimit()
const config = readAppConfig()
const repo = createHelpdeskRepository()
const linear = createLinearGateway(config.linear)

try {
  const result = await backfillMissingDetailsComments({ repo, linear, limit })
  console.log(JSON.stringify(result, null, 2))

  if (result.failed > 0) process.exitCode = 1
} finally {
  await closeDb()
}

function readLimit() {
  const limitArg = process.argv.find((arg) => arg.startsWith("--limit="))
  const rawLimit =
    limitArg?.slice("--limit=".length) ?? process.env.BACKFILL_LIMIT ?? "100"
  const parsedLimit = Number.parseInt(rawLimit, 10)

  if (!Number.isInteger(parsedLimit) || parsedLimit < 1) {
    throw new Error("Backfill limit must be a positive integer")
  }

  return parsedLimit
}

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
