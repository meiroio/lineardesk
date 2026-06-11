import { describe, expect, it } from "vitest"

import { normalizeConnectionString } from "../db/connection"

describe("normalizeConnectionString", () => {
  it("pins sslmode=verify-full for remote URLs, replacing require", () => {
    const out = normalizeConnectionString(
      "postgresql://u:p@ep-x-pooler.eu.aws.neon.tech/db?sslmode=require&channel_binding=require"
    )

    expect(out).toContain("sslmode=verify-full")
    expect(out).not.toContain("sslmode=require")
    expect(out).toContain("channel_binding=require")
  })

  it("adds sslmode=verify-full when a remote URL has none", () => {
    expect(
      normalizeConnectionString("postgresql://u:p@db.example.com/app")
    ).toContain("sslmode=verify-full")
  })

  it("leaves local connections untouched", () => {
    const local = "postgres://lineardesk:lineardesk@localhost:5433/lineardesk"
    expect(normalizeConnectionString(local)).toBe(local)
  })
})
