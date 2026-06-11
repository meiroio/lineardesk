/**
 * Send a correctly-signed Linear webhook to a running LinearDesk instance.
 *
 * Exercises the real route, real HMAC verification, and real DB write — the
 * exact production code path — with no external dependency on Linear.
 *
 * The <linearIssueId> MUST match an existing request's stored linearIssueId
 * (the webhook updates rows WHERE linearIssueId = data.id); otherwise the
 * route still returns ok but nothing changes.
 *
 *   bun run scripts/send-test-webhook.ts <linearIssueId> [stateName] [stateType] [stateId]
 *
 * stateType ∈ triage | backlog | unstarted | started | completed | canceled
 *
 * Env (Bun auto-loads .env.local):
 *   LINEAR_WEBHOOK_SECRET  required — must match the server's secret
 *   WEBHOOK_URL            default http://localhost:3000/api/linear/webhook
 *   IDENTIFIER, ISSUE_URL  optional overrides for the payload
 */
import { createHmac } from "node:crypto"
import process from "node:process"

const SECRET = process.env.LINEAR_WEBHOOK_SECRET
if (!SECRET) {
  console.error("Set LINEAR_WEBHOOK_SECRET (e.g. in .env.local) first.")
  process.exit(1)
}

const issueId = process.argv[2] ?? process.env.ISSUE_ID
if (!issueId) {
  console.error(
    "Usage: bun run scripts/send-test-webhook.ts <linearIssueId> [stateName] [stateType] [stateId]"
  )
  process.exit(1)
}

const url =
  process.env.WEBHOOK_URL ?? "http://localhost:3000/api/linear/webhook"
const stateName = process.argv[3] ?? "Done"
const stateType = process.argv[4] ?? "completed"
const stateId = process.argv[5] ?? `state-${stateType}`

const body = JSON.stringify({
  type: "Issue",
  action: "update",
  webhookId: "local-test",
  // Vary per run so the idempotency key changes and the event isn't deduped.
  webhookTimestamp: Date.now(),
  data: {
    id: issueId,
    identifier: process.env.IDENTIFIER ?? "BAS-LOCAL",
    url: process.env.ISSUE_URL ?? "https://linear.app/local/issue/BAS-LOCAL",
    state: { id: stateId, name: stateName, type: stateType },
  },
})

// Linear signs the raw body with HMAC-SHA256. We omit the linear-timestamp
// header on purpose: parseData only enforces the ±60s replay window when that
// header is present, so omitting it keeps local testing clock-independent.
const signature = createHmac("sha256", SECRET).update(body).digest("hex")

const res = await fetch(url, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "linear-signature": signature,
  },
  body,
})

console.log(`→ POST ${url}`)
console.log(`  issue ${issueId} → ${stateName} (${stateType})`)
console.log(`← ${res.status} ${res.statusText}`)
console.log(`  ${await res.text()}`)
