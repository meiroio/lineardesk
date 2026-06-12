import { createHmac, timingSafeEqual } from "node:crypto"

const FIVE_MINUTES_MS = 5 * 60 * 1000

export function verifySlackSignature(input: {
  signingSecret: string
  signature: string | null
  timestamp: string | null
  rawBody: string
  nowMs: number
}): boolean {
  if (!input.signature || !input.timestamp) return false

  const tsSeconds = Number.parseInt(input.timestamp, 10)
  if (!Number.isFinite(tsSeconds)) return false
  if (Math.abs(input.nowMs - tsSeconds * 1000) > FIVE_MINUTES_MS) return false

  const expected = `v0=${createHmac("sha256", input.signingSecret)
    .update(`v0:${input.timestamp}:${input.rawBody}`)
    .digest("hex")}`

  const a = Buffer.from(expected)
  const b = Buffer.from(input.signature)
  return a.length === b.length && timingSafeEqual(a, b)
}
