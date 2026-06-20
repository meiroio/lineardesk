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
    organizationId: "org-1",
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
    hasProcessedSlackEvent: vi.fn(async () => false),
    recordSlackEvent: vi.fn(async () => undefined),
    updateRequestFromLinear: vi.fn(async () => undefined),
    updateRequestFields: vi.fn(async () => makeRecord()),
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
    updateIssueFields: vi.fn(),
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
    openView: vi.fn(async () => "V1"),
    updateView: vi.fn(async () => {}),
    postMessage: vi.fn(async () => ({ channel: "C1", ts: "1.2" })),
    getUserEmail: vi.fn(async () => "person@example.com"),
    downloadFile: vi.fn(async () => ({
      bytes: new Uint8Array([1]),
      contentType: "image/png",
    })),
    getPermalink: vi.fn(async () => "https://acme.slack.com/archives/C1/p12"),
    getThreadReplies: vi.fn(async () => ({ messages: [] })),
  }
}

function makeGemini() {
  return {
    extractTicketDraft: vi.fn(async () => ({
      title: "CSV export 500s",
      expectedBehaviour: "works",
      currentBehaviour: "500",
      stepsToReproduce: "click export",
    })),
  }
}

function eventsBody(payloadObj: unknown) {
  return JSON.stringify(payloadObj)
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

  it("message_action opens a prefilled modal with mapped files", async () => {
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
    const payloadObj = {
      type: "message_action",
      trigger_id: "T2",
      channel: { id: "C1" },
      user: { id: "U1" },
      message: {
        ts: "1.1",
        text: "screen is blank",
        files: [
          {
            id: "F1",
            name: "shot.png",
            mimetype: "image/png",
            url_private: "https://files/F1",
          },
        ],
      },
    }
    const raw = `payload=${encodeURIComponent(JSON.stringify(payloadObj))}`
    const res = await app.fetch(
      new Request("http://localhost/api/slack/interactivity", {
        method: "POST",
        headers: slackHeaders("sign", raw),
        body: raw,
      })
    )
    expect(res.status).toBe(200)
    expect(slack.openView).toHaveBeenCalledWith("T2", expect.any(Object))
    const view = (slack.openView as ReturnType<typeof vi.fn>).mock.calls[0][1]
    const meta = JSON.parse(view.private_metadata)
    expect(meta.channel).toBe("C1")
    expect(meta.files[0].urlPrivate).toBe("https://files/F1")
    const descBlock = view.blocks.find(
      (b: { block_id: string }) => b.block_id === "currentBehaviour"
    )
    expect(descBlock.element.initial_value).toContain("screen is blank")
  })

  it("opens a loading view then updates with the AI draft", async () => {
    const slack = makeSlack()
    const gemini = makeGemini()
    slack.getThreadReplies = vi.fn(async () => ({
      messages: [{ user: "U1", text: "export 500s", files: [] }],
    }))
    const cfg = {
      ...config,
      slack: { signingSecret: "sign", botToken: "xoxb" },
      gemini: { apiKey: "g", model: "gemini-3.5-flash" },
    }
    const app = createApiApp({
      config: cfg,
      repo: makeRepo(),
      linear: makeLinear(),
      slack,
      gemini,
      auth: { getSession: vi.fn(async () => null) },
    })
    const payloadObj = {
      type: "message_action",
      trigger_id: "T2",
      channel: { id: "C1" },
      user: { id: "U1" },
      message: { ts: "1.1", text: "export 500s" },
    }
    const raw = `payload=${encodeURIComponent(JSON.stringify(payloadObj))}`
    const res = await app.fetch(
      new Request("http://localhost/api/slack/interactivity", {
        method: "POST",
        headers: slackHeaders("sign", raw),
        body: raw,
      })
    )
    expect(res.status).toBe(200)
    await vi.waitFor(() => {
      expect(gemini.extractTicketDraft).toHaveBeenCalled()
      expect(slack.updateView).toHaveBeenCalledWith(
        "V1",
        expect.objectContaining({ callback_id: "slack_ticket_submit" })
      )
    })
  })

  it("falls back to a message-prefilled form when the AI step fails", async () => {
    const slack = makeSlack()
    const gemini = makeGemini()
    gemini.extractTicketDraft = vi.fn(async () => {
      throw new Error("gemini down")
    })
    slack.getThreadReplies = vi.fn(async () => ({
      messages: [{ user: "U1", text: "export 500s", files: [] }],
    }))
    const cfg = {
      ...config,
      slack: { signingSecret: "sign", botToken: "xoxb" },
      gemini: { apiKey: "g", model: "gemini-3.5-flash" },
    }
    const app = createApiApp({
      config: cfg,
      repo: makeRepo(),
      linear: makeLinear(),
      slack,
      gemini,
      auth: { getSession: vi.fn(async () => null) },
    })
    const payloadObj = {
      type: "message_action",
      trigger_id: "T4",
      channel: { id: "C1" },
      user: { id: "U1" },
      message: { ts: "1.1", text: "the export button 500s" },
    }
    const raw = `payload=${encodeURIComponent(JSON.stringify(payloadObj))}`
    const res = await app.fetch(
      new Request("http://localhost/api/slack/interactivity", {
        method: "POST",
        headers: slackHeaders("sign", raw),
        body: raw,
      })
    )
    expect(res.status).toBe(200)
    await vi.waitFor(() => {
      expect(slack.updateView).toHaveBeenCalledWith(
        "V1",
        expect.objectContaining({ callback_id: "slack_ticket_submit" })
      )
    })
    // the fallback form carries the original message text in Current behaviour
    const updateArg = (slack.updateView as ReturnType<typeof vi.fn>).mock
      .calls[0][1] as {
      blocks: { block_id?: string; element?: { initial_value?: string } }[]
    }
    const current = updateArg.blocks.find(
      (b) => b.block_id === "currentBehaviour"
    )
    expect(current?.element?.initial_value).toContain("the export button 500s")
  })

  it("opens the form directly when gemini is unconfigured", async () => {
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
    const payloadObj = {
      type: "message_action",
      trigger_id: "T3",
      channel: { id: "C1" },
      user: { id: "U1" },
      message: { ts: "1.1", text: "hi" },
    }
    const raw = `payload=${encodeURIComponent(JSON.stringify(payloadObj))}`
    const res = await app.fetch(
      new Request("http://localhost/api/slack/interactivity", {
        method: "POST",
        headers: slackHeaders("sign", raw),
        body: raw,
      })
    )
    expect(res.status).toBe(200)
    expect(slack.openView).toHaveBeenCalledWith(
      "T3",
      expect.objectContaining({ callback_id: "slack_ticket_submit" })
    )
    expect(slack.updateView).not.toHaveBeenCalled()
  })

  it("view_submission happy path creates a ticket and confirms in-thread", async () => {
    const slack = makeSlack()
    const repo = makeRepo()
    const linear = makeLinear()
    ;(linear.createHelpdeskIssue as ReturnType<typeof vi.fn>).mockResolvedValue(
      {
        id: "i",
        identifier: "BAS-123",
        url: "https://l/BAS-123",
        detailsCommentId: null,
        state: { id: "s", name: "Triage", type: "triage" },
      }
    )
    const cfg = {
      ...config,
      slack: { signingSecret: "sign", botToken: "xoxb" },
    }
    const app = createApiApp({
      config: cfg,
      repo,
      linear,
      slack,
      auth: { getSession: vi.fn(async () => null) },
    })
    const payloadObj = {
      type: "view_submission",
      user: { id: "U1" },
      view: {
        callback_id: "slack_ticket_submit",
        private_metadata: JSON.stringify({
          channel: "C1",
          messageTs: "1.1",
          threadTs: "1.1",
          files: [],
        }),
        state: {
          values: {
            title: { title_input: { value: "Login broken" } },
            expectedBehaviour: {
              expectedBehaviour_input: {
                value: "Should redirect to dashboard",
              },
            },
            currentBehaviour: {
              currentBehaviour_input: { value: "500 on submit" },
            },
            stepsToReproduce: {
              stepsToReproduce_input: {
                value: "1. Enter credentials 2. Submit",
              },
            },
            severity: {
              severity_input: { selected_option: { value: "high" } },
            },
          },
        },
      },
    }
    const raw = `payload=${encodeURIComponent(JSON.stringify(payloadObj))}`
    const res = await app.fetch(
      new Request("http://localhost/api/slack/interactivity", {
        method: "POST",
        headers: slackHeaders("sign", raw),
        body: raw,
      })
    )
    expect(res.status).toBe(200)
    await vi.waitFor(() => {
      expect(repo.createRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          source: "slack",
          organizationId: null,
          requesterEmail: "person@example.com",
          slackChannelId: "C1",
        })
      )
    })
    await vi.waitFor(() => {
      expect(slack.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: "C1",
          text: expect.stringContaining("BAS-"),
        })
      )
    })
  })

  it("view_submission with invalid input returns response_action errors", async () => {
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
    const payloadObj = {
      type: "view_submission",
      user: { id: "U1" },
      view: {
        callback_id: "slack_ticket_submit",
        private_metadata: JSON.stringify({
          channel: "C1",
          messageTs: "1.1",
          threadTs: "1.1",
          files: [],
        }),
        state: {
          values: {
            title: { title_input: { value: "x" } },
            expectedBehaviour: {
              expectedBehaviour_input: { value: "" },
            },
            currentBehaviour: {
              currentBehaviour_input: { value: "Something broken" },
            },
            stepsToReproduce: {
              stepsToReproduce_input: { value: "1. Do it" },
            },
            severity: {
              severity_input: { selected_option: { value: "medium" } },
            },
          },
        },
      },
    }
    const raw = `payload=${encodeURIComponent(JSON.stringify(payloadObj))}`
    const res = await app.fetch(
      new Request("http://localhost/api/slack/interactivity", {
        method: "POST",
        headers: slackHeaders("sign", raw),
        body: raw,
      })
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({
      response_action: "errors",
      errors: expect.any(Object),
    })
    expect(body.errors.expectedBehaviour).toBeDefined()
  })

  it("echoes the url_verification challenge", async () => {
    const cfg = {
      ...config,
      slack: { signingSecret: "sign", botToken: "xoxb" },
    }
    const app = createApiApp({
      config: cfg,
      repo: makeRepo(),
      linear: makeLinear(),
      slack: makeSlack(),
      auth: { getSession: vi.fn(async () => null) },
    })
    const raw = eventsBody({ type: "url_verification", challenge: "abc" })
    const res = await app.fetch(
      new Request("http://localhost/api/slack/events", {
        method: "POST",
        headers: slackHeaders("sign", raw),
        body: raw,
      })
    )
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ challenge: "abc" })
  })

  it("auto-creates a ticket on app_mention and confirms with a portal link", async () => {
    const slack = makeSlack()
    slack.getThreadReplies = vi.fn(async () => ({
      messages: [{ user: "U1", text: "export 500s", files: [] }],
    }))
    const gemini = makeGemini()
    const repo = makeRepo()
    const linear = makeLinear()
    ;(linear.createHelpdeskIssue as ReturnType<typeof vi.fn>).mockResolvedValue(
      {
        id: "i",
        identifier: "BAS-123",
        url: "https://l/BAS-123",
        detailsCommentId: null,
        state: { id: "s", name: "Triage", type: "triage" },
      }
    )
    const cfg = {
      ...config,
      betterAuthUrl: "https://portal.example",
      slack: { signingSecret: "sign", botToken: "xoxb" },
      gemini: { apiKey: "g", model: "gemini-3.5-flash" },
    }
    const app = createApiApp({
      config: cfg,
      repo,
      linear,
      slack,
      gemini,
      auth: { getSession: vi.fn(async () => null) },
    })
    const raw = eventsBody({
      event_id: "Ev1",
      event: { type: "app_mention", user: "U1", channel: "C1", ts: "1.1" },
    })
    const res = await app.fetch(
      new Request("http://localhost/api/slack/events", {
        method: "POST",
        headers: slackHeaders("sign", raw),
        body: raw,
      })
    )
    expect(res.status).toBe(200)
    await vi.waitFor(() => {
      expect(repo.createRequest).toHaveBeenCalled()
      expect(slack.postMessage).toHaveBeenCalled()
    })
    const confirmText = (slack.postMessage as ReturnType<typeof vi.fn>).mock
      .calls.at(-1)?.[0]?.text as string
    // The confirmation echoes the AI draft (title + the bug-report
    // description) so the requester can validate it inline without opening
    // the portal, and still links to the portal edit page.
    expect(confirmText).toContain("CSV export 500s")
    expect(confirmText).toContain("Expected behaviour")
    expect(confirmText).toContain("https://portal.example/requests/")
  })

  it("builds the portal link without a double slash when betterAuthUrl ends in /", async () => {
    const slack = makeSlack()
    slack.getThreadReplies = vi.fn(async () => ({
      messages: [{ user: "U1", text: "export 500s", files: [] }],
    }))
    const repo = makeRepo()
    const linear = makeLinear()
    ;(linear.createHelpdeskIssue as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "i",
      identifier: "BAS-11",
      url: "https://l/BAS-11",
      detailsCommentId: null,
      state: { id: "s", name: "Triage", type: "triage" },
    })
    const cfg = {
      ...config,
      betterAuthUrl: "https://portal.example/",
      slack: { signingSecret: "sign", botToken: "xoxb" },
      gemini: { apiKey: "g", model: "gemini-3.5-flash" },
    }
    const app = createApiApp({
      config: cfg,
      repo,
      linear,
      slack,
      gemini: makeGemini(),
      auth: { getSession: vi.fn(async () => null) },
    })
    const raw = eventsBody({
      event_id: "EvSlash",
      event: { type: "app_mention", user: "U1", channel: "C1", ts: "1.1" },
    })
    await app.fetch(
      new Request("http://localhost/api/slack/events", {
        method: "POST",
        headers: slackHeaders("sign", raw),
        body: raw,
      })
    )
    await vi.waitFor(() => expect(slack.postMessage).toHaveBeenCalled())
    const text = (slack.postMessage as ReturnType<typeof vi.fn>).mock.calls.at(
      -1
    )?.[0]?.text as string
    expect(text).toContain("https://portal.example/requests/")
    expect(text).not.toContain("//requests")
  })

  it("ignores a duplicate event_id", async () => {
    const slack = makeSlack()
    const repo = makeRepo()
    repo.hasProcessedSlackEvent = vi.fn(async () => true)
    const cfg = {
      ...config,
      slack: { signingSecret: "sign", botToken: "xoxb" },
      gemini: { apiKey: "g", model: "m" },
    }
    const app = createApiApp({
      config: cfg,
      repo,
      linear: makeLinear(),
      slack,
      gemini: makeGemini(),
      auth: { getSession: vi.fn(async () => null) },
    })
    const raw = eventsBody({
      event_id: "Ev1",
      event: { type: "app_mention", user: "U1", channel: "C1", ts: "1.1" },
    })
    await app.fetch(
      new Request("http://localhost/api/slack/events", {
        method: "POST",
        headers: slackHeaders("sign", raw),
        body: raw,
      })
    )
    expect(repo.createRequest).not.toHaveBeenCalled()
  })

  it("hands mention work to the runtime waitUntil when present (serverless)", async () => {
    const scheduled: Promise<unknown>[] = []
    const sym = Symbol.for("@vercel/request-context")
    ;(globalThis as Record<symbol, unknown>)[sym] = {
      get: () => ({ waitUntil: (p: Promise<unknown>) => scheduled.push(p) }),
    }
    try {
      const slack = makeSlack()
      slack.getThreadReplies = vi.fn(async () => ({
        messages: [{ user: "U1", text: "export 500s", files: [] }],
      }))
      const repo = makeRepo()
      const linear = makeLinear()
      ;(
        linear.createHelpdeskIssue as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        id: "i",
        identifier: "BAS-9",
        url: "https://l/BAS-9",
        detailsCommentId: null,
        state: { id: "s", name: "Triage", type: "triage" },
      })
      const cfg = {
        ...config,
        betterAuthUrl: "https://portal.example",
        slack: { signingSecret: "sign", botToken: "xoxb" },
        gemini: { apiKey: "g", model: "gemini-3.5-flash" },
      }
      const app = createApiApp({
        config: cfg,
        repo,
        linear,
        slack,
        gemini: makeGemini(),
        auth: { getSession: vi.fn(async () => null) },
      })
      const raw = eventsBody({
        event_id: "EvWU",
        event: { type: "app_mention", user: "U1", channel: "C1", ts: "1.1" },
      })
      const res = await app.fetch(
        new Request("http://localhost/api/slack/events", {
          method: "POST",
          headers: slackHeaders("sign", raw),
          body: raw,
        })
      )
      expect(res.status).toBe(200)
      // The post-ack work must be registered with the runtime's waitUntil so
      // the serverless function stays alive to run it — not fire-and-forgotten.
      expect(scheduled).toHaveLength(1)
      await Promise.all(scheduled)
      expect(repo.createRequest).toHaveBeenCalled()
      expect(slack.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining("https://portal.example/requests/"),
        })
      )
    } finally {
      ;(globalThis as Record<symbol, unknown>)[sym] = undefined
    }
  })

  it("awaits mention work when no runtime waitUntil is available", async () => {
    const slack = makeSlack()
    slack.getThreadReplies = vi.fn(async () => ({
      messages: [{ user: "U1", text: "export 500s", files: [] }],
    }))
    const repo = makeRepo()
    const linear = makeLinear()
    ;(linear.createHelpdeskIssue as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "i",
      identifier: "BAS-10",
      url: "https://l/BAS-10",
      detailsCommentId: null,
      state: { id: "s", name: "Triage", type: "triage" },
    })
    const cfg = {
      ...config,
      betterAuthUrl: "https://portal.example",
      slack: { signingSecret: "sign", botToken: "xoxb" },
      gemini: { apiKey: "g", model: "gemini-3.5-flash" },
    }
    const app = createApiApp({
      config: cfg,
      repo,
      linear,
      slack,
      gemini: makeGemini(),
      auth: { getSession: vi.fn(async () => null) },
    })
    const raw = eventsBody({
      event_id: "EvAwait",
      event: { type: "app_mention", user: "U1", channel: "C1", ts: "1.1" },
    })
    const res = await app.fetch(
      new Request("http://localhost/api/slack/events", {
        method: "POST",
        headers: slackHeaders("sign", raw),
        body: raw,
      })
    )
    expect(res.status).toBe(200)
    // With no waitUntil the route must AWAIT the work, so the ticket already
    // exists by the time the response resolves (no polling / vi.waitFor).
    expect(repo.createRequest).toHaveBeenCalled()
    expect(slack.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("https://portal.example/requests/"),
      })
    )
  })
})
