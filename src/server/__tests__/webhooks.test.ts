import { createHmac } from "node:crypto"

import { describe, expect, it } from "vitest"

import {
  extractIssueSnapshotFromWebhook,
  getLinearWebhookEventKey,
  verifyLinearWebhookPayload,
} from "../webhooks"

function sign(rawBody: string, secret: string) {
  return createHmac("sha256", secret).update(rawBody).digest("hex")
}

describe("verifyLinearWebhookPayload", () => {
  it("verifies Linear webhook HMAC signatures", () => {
    const rawBody = JSON.stringify({
      type: "Issue",
      action: "update",
      webhookTimestamp: Date.now(),
      data: { id: "issue-id" },
    })

    expect(
      verifyLinearWebhookPayload({
        rawBody,
        signature: sign(rawBody, "secret"),
        secret: "secret",
      })
    ).toMatchObject({ type: "Issue", action: "update" })
  })

  it("rejects invalid signatures", () => {
    expect(() =>
      verifyLinearWebhookPayload({
        rawBody: JSON.stringify({ type: "Issue", data: { id: "issue-id" } }),
        signature: "bad-signature",
        secret: "secret",
      })
    ).toThrow()
  })
})

describe("Linear issue webhook extraction", () => {
  it("extracts the issue state snapshot used by the portal", () => {
    const snapshot = extractIssueSnapshotFromWebhook({
      type: "Issue",
      action: "update",
      data: {
        id: "issue-id",
        identifier: "BAS-123",
        url: "https://linear.app/acme/issue/BAS-123",
        state: {
          id: "state-id",
          name: "In Progress",
          type: "started",
        },
      },
    })

    expect(snapshot).toEqual({
      linearIssueId: "issue-id",
      linearIdentifier: "BAS-123",
      linearUrl: "https://linear.app/acme/issue/BAS-123",
      linearStateId: "state-id",
      linearStateName: "In Progress",
      linearStateType: "started",
    })
  })

  it("builds a stable idempotency key from webhook identity fields", () => {
    expect(
      getLinearWebhookEventKey({
        type: "Issue",
        action: "update",
        webhookId: "webhook-id",
        webhookTimestamp: 1,
        data: { id: "issue-id" },
      })
    ).toBe("Issue:update:webhook-id:issue-id:1")
  })
})
