import { describe, expect, it, vi } from "vitest"

import { createApiApp } from "../app"
import type {
  AppConfig,
  AuthBridge,
  AuthSession,
  HelpdeskRepository,
  LinearGateway,
  RequestRecord,
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

const session: AuthSession = {
  user: {
    id: "user-id",
    email: "person@example.com",
    name: "Person Example",
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
    ...overrides,
  }
}

function makeRepo(): HelpdeskRepository {
  return {
    createRequest: vi.fn(async () => makeRecord()),
    listRequestsForUser: vi.fn(async () => [makeRecord()]),
    getRequestForUser: vi.fn(async () => makeRecord()),
    listRequestsMissingDetailsComment: vi.fn(async () => []),
    markDetailsCommentCreated: vi.fn(async () => undefined),
    hasProcessedWebhookEvent: vi.fn(async () => false),
    recordWebhookEvent: vi.fn(async () => undefined),
    updateRequestFromLinear: vi.fn(async () => undefined),
  }
}

describe("createApiApp", () => {
  it("mounts the Better Auth handler under the Elysia API app", async () => {
    const authHandler = vi.fn(async (request: Request) => {
      return Response.json({ path: new URL(request.url).pathname })
    })
    const app = createApiApp({
      config,
      repo: makeRepo(),
      linear: {
        createHelpdeskIssue: vi.fn(),
        createHelpdeskIssueDetailsComment: vi.fn(),
        createIssueComment: vi.fn(),
        listIssueComments: vi.fn(async () => []),
        uploadAsset: vi.fn(),
      },
      auth: {
        handler: authHandler,
        getSession: vi.fn(async () => null),
      },
    })

    const response = await app.fetch(
      new Request("http://localhost/api/auth/get-session")
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      path: "/api/auth/get-session",
    })
    expect(authHandler).toHaveBeenCalled()
  })

  it("creates a Linear issue and stores a helpdesk request", async () => {
    const repo = makeRepo()
    const linear = {
      createHelpdeskIssue: vi.fn(async () => ({
        id: "linear-issue-id",
        identifier: "BAS-123",
        url: "https://linear.app/acme/issue/BAS-123",
        detailsCommentId: "comment-id",
        state: {
          id: "state-id",
          name: "Triage",
          type: "triage",
        },
      })),
      createHelpdeskIssueDetailsComment: vi.fn(),
      createIssueComment: vi.fn(),
      listIssueComments: vi.fn(async () => []),
      uploadAsset: vi.fn(),
    }
    const app = createApiApp({
      config,
      repo,
      linear,
      auth: { getSession: vi.fn(async () => session) },
    })

    const response = await app.fetch(
      new Request("http://localhost/api/requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: " Cannot sign in ",
          expectedBehaviour: " Google sign-in succeeds. ",
          currentBehaviour: " Google sign-in fails after redirect. ",
          stepsToReproduce: " 1. Click sign in 2. Pick account ",
          severity: "high",
        }),
      })
    )

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({
      request: {
        id: "request-id",
        linearIdentifier: "BAS-123",
      },
    })
    expect(linear.createHelpdeskIssue).toHaveBeenCalledWith({
      title: "Cannot sign in",
      description:
        "Expected behaviour\nGoogle sign-in succeeds.\n\n" +
        "Current behaviour\nGoogle sign-in fails after redirect.\n\n" +
        "Steps to reproduce\n1. Click sign in 2. Pick account",
      requesterEmail: "person@example.com",
      priority: 2,
    })
    expect(repo.createRequest).toHaveBeenCalled()
  })

  it("rejects authenticated users outside the allow-listed domains", async () => {
    const app = createApiApp({
      config,
      repo: makeRepo(),
      linear: {
        createHelpdeskIssue: vi.fn(),
        createHelpdeskIssueDetailsComment: vi.fn(),
        createIssueComment: vi.fn(),
        listIssueComments: vi.fn(async () => []),
        uploadAsset: vi.fn(),
      },
      auth: {
        getSession: vi.fn(async () => ({
          user: { ...session.user, email: "person@evil.test" },
        })),
      },
    })

    const response = await app.fetch(
      new Request("http://localhost/api/requests")
    )

    expect(response.status).toBe(403)
  })

  it("does not process the same Linear webhook event twice", async () => {
    const repo = makeRepo()
    vi.mocked(repo.hasProcessedWebhookEvent).mockResolvedValue(true)
    const app = createApiApp({
      config,
      repo,
      linear: {
        createHelpdeskIssue: vi.fn(),
        createHelpdeskIssueDetailsComment: vi.fn(),
        createIssueComment: vi.fn(),
        listIssueComments: vi.fn(async () => []),
        uploadAsset: vi.fn(),
      },
      auth: { getSession: vi.fn(async () => session) },
      verifyWebhook: vi.fn(async () => ({
        type: "Issue",
        action: "update",
        webhookId: "webhook-id",
        webhookTimestamp: 1,
        data: { id: "linear-issue-id" },
      })),
    })

    const response = await app.fetch(
      new Request("http://localhost/api/linear/webhook", {
        method: "POST",
        body: JSON.stringify({ type: "Issue" }),
      })
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      duplicate: true,
    })
    expect(repo.updateRequestFromLinear).not.toHaveBeenCalled()
  })

  it("returns Linear comments with a request detail", async () => {
    const repo = makeRepo()
    const linear = {
      createHelpdeskIssue: vi.fn(),
      createHelpdeskIssueDetailsComment: vi.fn(),
      createIssueComment: vi.fn(),
      listIssueComments: vi.fn(async () => [
        {
          id: "comment-id",
          body: "Is it? Where? What?",
          authorName: "adam.sobotka",
          createdAt: new Date("2026-01-01T00:30:00.000Z"),
        },
      ]),
      uploadAsset: vi.fn(),
    }
    const app = createApiApp({
      config,
      repo,
      linear,
      auth: { getSession: vi.fn(async () => session) },
    })

    const response = await app.fetch(
      new Request("http://localhost/api/requests/request-id")
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      request: {
        id: "request-id",
        comments: [
          {
            id: "comment-id",
            body: "Is it? Where? What?",
            authorName: "adam.sobotka",
            createdAt: "2026-01-01T00:30:00.000Z",
          },
        ],
      },
    })
    expect(linear.listIssueComments).toHaveBeenCalledWith("linear-issue-id")
  })

  it("creates requester replies as Linear comments", async () => {
    const repo = makeRepo()
    const linear = {
      createHelpdeskIssue: vi.fn(),
      createHelpdeskIssueDetailsComment: vi.fn(),
      createIssueComment: vi.fn(async () => ({
        id: "reply-id",
        body: "Requester: person@example.com\n\nIs it still broken?",
        authorName: "Desk",
        createdAt: new Date("2026-01-01T00:45:00.000Z"),
      })),
      listIssueComments: vi.fn(async () => []),
      uploadAsset: vi.fn(),
    }
    const app = createApiApp({
      config,
      repo,
      linear,
      auth: { getSession: vi.fn(async () => session) },
    })

    const response = await app.fetch(
      new Request("http://localhost/api/requests/request-id/comments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: " Is it still broken? " }),
      })
    )

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({
      comment: {
        id: "reply-id",
        body: "Requester: person@example.com\n\nIs it still broken?",
        authorName: "Desk",
        createdAt: "2026-01-01T00:45:00.000Z",
      },
    })
    expect(linear.createIssueComment).toHaveBeenCalledWith({
      issueId: "linear-issue-id",
      body: "Requester: person@example.com\n\nIs it still broken?",
    })
  })
})

describe("POST /api/uploads", () => {
  function makeApp(overrides?: {
    uploadAsset?: LinearGateway["uploadAsset"]
    getSession?: AuthBridge["getSession"]
  }) {
    const linear = {
      createHelpdeskIssue: vi.fn(),
      createHelpdeskIssueDetailsComment: vi.fn(),
      createIssueComment: vi.fn(),
      listIssueComments: vi.fn(async () => []),
      uploadAsset:
        overrides?.uploadAsset ??
        vi.fn(async () => ({ assetUrl: "https://uploads.linear.app/abc.png" })),
    }
    const app = createApiApp({
      config,
      repo: makeRepo(),
      linear,
      auth: { getSession: overrides?.getSession ?? vi.fn(async () => session) },
    })
    return { app, linear }
  }

  it("uploads a pasted image to Linear and returns the asset URL", async () => {
    const { app, linear } = makeApp()

    const response = await app.fetch(
      new Request("http://localhost/api/uploads", {
        method: "POST",
        headers: { "content-type": "image/png", "x-filename": "shot.png" },
        body: new Uint8Array([1, 2, 3, 4]),
      })
    )

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toEqual({
      assetUrl: "https://uploads.linear.app/abc.png",
      filename: "shot.png",
    })
    expect(linear.uploadAsset).toHaveBeenCalled()
  })

  it("rejects non-image content types", async () => {
    const { app } = makeApp()

    const response = await app.fetch(
      new Request("http://localhost/api/uploads", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: new Uint8Array([1, 2, 3]),
      })
    )

    expect(response.status).toBe(400)
  })

  it("rejects uploads over the size limit", async () => {
    const { app } = makeApp()

    const response = await app.fetch(
      new Request("http://localhost/api/uploads", {
        method: "POST",
        headers: { "content-type": "image/png" },
        body: new Uint8Array(20 * 1024 * 1024 + 1),
      })
    )

    expect(response.status).toBe(413)
  })

  it("rejects unauthenticated uploads", async () => {
    const { app } = makeApp({ getSession: vi.fn(async () => null) })

    const response = await app.fetch(
      new Request("http://localhost/api/uploads", {
        method: "POST",
        headers: { "content-type": "image/png" },
        body: new Uint8Array([1, 2, 3]),
      })
    )

    expect(response.status).toBe(401)
  })
})
