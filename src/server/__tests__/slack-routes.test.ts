import { createHmac } from "node:crypto"

import { describe, expect, it, vi } from "vitest"

import { createApiApp } from "../app"
import type {
  AppConfig,
  HelpdeskRepository,
  LinearGateway,
  RequestRecord,
  SlackGateway,
} from "../types"

const config: AppConfig = {
  allowedEmailDomains: ["example.com"],
  databaseUrl: "postgres://lineardesk:lineardesk@localhost:5432/lineardesk",
  betterAuthSecret: "test-secret",
  betterAuthUrl: "http://localhost:3000",
  googleClientId: "google-id",
  googleClientSecret: "google-secret",
  linear: {
    apiKey: "lin_api_key",
    teamId: "team-id",
    teamKey: "BAS",
    initialStateName: "Triage",
    labelName: "Bug",
    webhookSecret: "webhook-secret",
  },
}

function makeRecord(overrides: Partial<RequestRecord> = {}): RequestRecord {
  return {
    id: "request-id",
    requesterUserId: "user-id",
    requesterEmail: "person@example.com",
    title: "Cannot sign in",
    description: "Google sign-in fails after redirect.",
    linearIssueId: "linear-issue-id",
    linearIdentifier: "BAS-123",
    linearUrl: "https://linear.app/acme/issue/BAS-123",
    linearTeamId: "team-id",
    linearStateId: "state-id",
    linearStateName: "Triage",
    linearStateType: "triage",
    severity: 3,
    linearDetailsCommentId: "comment-id",
    linearDetailsCommentedAt: new Date("2026-01-01T00:00:00.000Z"),
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    lastLinearSyncedAt: new Date("2026-01-01T00:00:00.000Z"),
    source: "web",
    slackChannelId: null,
    slackMessageTs: null,
    ...overrides,
  }
}

function makeRepo(): HelpdeskRepository {
  return {
    createRequest: vi.fn(async () => makeRecord()),
    getUserIdByEmail: vi.fn(async () => "user-id"),
    listRequestsForEmail: vi.fn(async () => [makeRecord()]),
    getRequestForEmail: vi.fn(async () => makeRecord()),
    listOpenRequests: vi.fn(async () => []),
    hasProcessedWebhookEvent: vi.fn(async () => false),
    recordWebhookEvent: vi.fn(async () => undefined),
    updateRequestFromLinear: vi.fn(async () => undefined),
  }
}

function makeLinear(): LinearGateway {
  return {
    createHelpdeskIssue: vi.fn(),
    closeIssue: vi.fn(),
    createIssueComment: vi.fn(),
    listIssueComments: vi.fn(async () => []),
    uploadAsset: vi.fn(),
    listIssueStates: vi.fn(async () => []),
  }
}

function slackHeaders(secret: string, body: string) {
  const ts = String(Math.floor(Date.now() / 1000))
  const sig = `v0=${createHmac("sha256", secret).update(`v0:${ts}:${body}`).digest("hex")}`
  return {
    "x-slack-signature": sig,
    "x-slack-request-timestamp": ts,
    "content-type": "application/x-www-form-urlencoded",
  }
}

function makeSlack(): SlackGateway {
  return {
    openView: vi.fn(async () => {}),
    postMessage: vi.fn(async () => ({ channel: "C1", ts: "1.2" })),
    getUserEmail: vi.fn(async () => "person@example.com"),
    downloadFile: vi.fn(async () => ({
      bytes: new Uint8Array([1]),
      contentType: "image/png",
    })),
  }
}

describe("slack routes", () => {
  it("does not mount slack routes when slack is unconfigured", async () => {
    const app = createApiApp({
      config,
      repo: makeRepo(),
      linear: makeLinear(),
      auth: { getSession: vi.fn(async () => null) },
    })
    const res = await app.fetch(
      new Request("http://localhost/api/slack/commands", {
        method: "POST",
        body: "",
      })
    )
    expect(res.status).toBe(404)
  })

  it("opens a modal on /ticket when configured", async () => {
    const slack = makeSlack()
    const cfg = {
      ...config,
      slack: { signingSecret: "sign", botToken: "xoxb" },
    }
    const app = createApiApp({
      config: cfg,
      repo: makeRepo(),
      linear: makeLinear(),
      slack,
      auth: { getSession: vi.fn(async () => null) },
    })
    const body = new URLSearchParams({
      trigger_id: "T1",
      channel_id: "C1",
      user_id: "U1",
      command: "/ticket",
      text: "",
    }).toString()
    const res = await app.fetch(
      new Request("http://localhost/api/slack/commands", {
        method: "POST",
        headers: slackHeaders("sign", body),
        body,
      })
    )
    expect(res.status).toBe(200)
    expect(slack.openView).toHaveBeenCalledWith(
      "T1",
      expect.objectContaining({ callback_id: "slack_ticket_submit" })
    )
  })

  it("rejects a bad signature", async () => {
    const slack = makeSlack()
    const cfg = {
      ...config,
      slack: { signingSecret: "sign", botToken: "xoxb" },
    }
    const app = createApiApp({
      config: cfg,
      repo: makeRepo(),
      linear: makeLinear(),
      slack,
      auth: { getSession: vi.fn(async () => null) },
    })
    const res = await app.fetch(
      new Request("http://localhost/api/slack/commands", {
        method: "POST",
        headers: {
          "x-slack-signature": "v0=bad",
          "x-slack-request-timestamp": "1",
          "content-type": "application/x-www-form-urlencoded",
        },
        body: "x=1",
      })
    )
    expect(res.status).toBe(401)
    expect(slack.openView).not.toHaveBeenCalled()
  })
})
