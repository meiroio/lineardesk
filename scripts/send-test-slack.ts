/**
 * Send a correctly-signed Slack slash-command payload to a running LinearDesk
 * instance.
 *
 * What this exercises
 * -------------------
 * Signature verification, route mounting/gating, and the initial request
 * handler — the same production code path that Slack itself hits. The happy
 * path then calls Slack's `views.open` API with the placeholder `trigger_id`
 * below; the REAL Slack API will reject that trigger as invalid, so against a
 * live server you should expect the route to reach openView and then return
 * a 500 (or surface an openView error). That is normal and expected.
 *
 * Primary uses
 * ------------
 *   • Confirm bad-signature → 401
 *   • Confirm unconfigured server (SLACK_SIGNING_SECRET unset) → 404
 *   • Confirm correct signature reaches the handler → any non-401/404
 *
 *   bun run scripts/send-test-slack.ts
 *
 * Env (Bun auto-loads .env.local):
 *   SLACK_SIGNING_SECRET  required — must match the server's secret
 *   WEBHOOK_URL           default http://localhost:3000/api/slack/commands
 */
import { createHmac } from "node:crypto"
import process from "node:process"

const SECRET = process.env.SLACK_SIGNING_SECRET
if (!SECRET) {
  console.error("Set SLACK_SIGNING_SECRET (e.g. in .env.local) first.")
  process.exit(1)
}

const url =
  process.env.WEBHOOK_URL ?? "http://localhost:3000/api/slack/commands"

const body = new URLSearchParams({
  trigger_id: "test-trigger",
  channel_id: "C0TEST",
  user_id: "U0TEST",
  command: "/ticket",
  text: "",
}).toString()

// Slack signs with "v0:<timestamp>:<body>" using HMAC-SHA256.
const ts = Math.floor(Date.now() / 1000).toString()
const sigBase = `v0:${ts}:${body}`
const signature =
  "v0=" + createHmac("sha256", SECRET).update(sigBase).digest("hex")

const res = await fetch(url, {
  method: "POST",
  headers: {
    "content-type": "application/x-www-form-urlencoded",
    "x-slack-signature": signature,
    "x-slack-request-timestamp": ts,
  },
  body,
})

console.log(`→ POST ${url}`)
console.log(`← ${res.status} ${res.statusText}`)
console.log(`  ${await res.text()}`)
