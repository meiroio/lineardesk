import { createHmac } from "node:crypto"

import { describe, expect, it } from "vitest"

import { verifySlackSignature } from "../slack/signature"

function sign(secret: string, ts: string, body: string) {
  const hmac = createHmac("sha256", secret).update(`v0:${ts}:${body}`)
  return `v0=${hmac.digest("hex")}`
}

const secret = "shhh"
const body = "token=x&command=%2Fticket"
const now = 1_900_000_000_000 // fixed "now" in ms

describe("verifySlackSignature", () => {
  it("accepts a valid, fresh signature", () => {
    const ts = String(Math.floor(now / 1000))
    expect(
      verifySlackSignature({
        signingSecret: secret,
        signature: sign(secret, ts, body),
        timestamp: ts,
        rawBody: body,
        nowMs: now,
      })
    ).toBe(true)
  })

  it("rejects a tampered body", () => {
    const ts = String(Math.floor(now / 1000))
    expect(
      verifySlackSignature({
        signingSecret: secret,
        signature: sign(secret, ts, body),
        timestamp: ts,
        rawBody: body + "&evil=1",
        nowMs: now,
      })
    ).toBe(false)
  })

  it("rejects a stale timestamp (> 5 min)", () => {
    const ts = String(Math.floor(now / 1000) - 600)
    expect(
      verifySlackSignature({
        signingSecret: secret,
        signature: sign(secret, ts, body),
        timestamp: ts,
        rawBody: body,
        nowMs: now,
      })
    ).toBe(false)
  })
})
