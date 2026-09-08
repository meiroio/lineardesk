import { afterEach, describe, expect, it, vi } from "vitest"

import { createApiApp } from "../app"
import type {
  AppConfig,
  AuthBridge,
  AuthSession,
  HelpdeskRepository,
  LinearGateway,
  RequestRecord,
  SlackGateway,
} from "../types"

const config: AppConfig = {
  email: {
    provider: "log",
    appName: "LinearDesk",
    from: "LinearDesk <noreply@lineardesk.local>",
  },
  databaseUrl: "postgres://lineardesk:lineardesk@localhost:5432/lineardesk",
  betterAuthSecret: "test-secret",
  betterAuthUrl: "http://localhost:3000",
  googleClientId: "google-id",
  googleClientSecret: "google-secret",
  linear: {
    clientId: "linear-client",
    clientSecret: "linear-secret",
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
  activeOrganizationId: "org-1",
  sessionToken: "session-token",
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
    listRequestsForOrganization: vi.fn(async () => ({
      requests: [makeRecord()],
      total: 1,
    })),
    getRequestForOrganization: vi.fn(async () => makeRecord()),
    getRequestByLinearIssueId: vi.fn(async () => makeRecord()),
    listOpenRequests: vi.fn(async () => []),
    applyWebhookEvent: vi.fn(async () => true),
    markRequestsSynced: vi.fn(async () => undefined),
    claimSlackEvent: vi.fn(async () => true),
    releaseSlackEvent: vi.fn(async () => undefined),
    updateRequestFromLinear: vi.fn(async () => undefined),
    updateRequestFields: vi.fn(async () => makeRecord()),
    updateRequestSeverity: vi.fn(async ({ severity }) =>
      makeRecord({ severity })
    ),
  }
}

function makeLinear(): LinearGateway {
  return {
    listTeams: vi.fn(async () => [{ id: "team-id", key: "BAS", name: "Base" }]),
    createHelpdeskIssue: vi.fn(),
    createIssueComment: vi.fn(),
    listIssueComments: vi.fn(async () => []),
    getIssueCommentBody: vi.fn(async () => null),
    listIssueStates: vi.fn(async () => []),
    uploadAsset: vi.fn(),
    downloadAsset: vi.fn(),
    closeIssue: vi.fn(),
    updateIssueFields: vi.fn(),
    updateIssuePriority: vi.fn(),
  }
}

function makeSlack(): SlackGateway {
  return {
    openView: vi.fn(async () => "view-id"),
    updateView: vi.fn(async () => undefined),
    postMessage: vi.fn(async () => ({ channel: "C1", ts: "1.2" })),
    getUserEmail: vi.fn(async () => "person@example.com"),
    findUserIdByEmail: vi.fn(async () => "U1"),
    getPermalink: vi.fn(async () => "https://example.slack.com/thread"),
    getThreadReplies: vi.fn(async () => ({ messages: [] })),
    downloadFile: vi.fn(async () => ({
      bytes: new Uint8Array(),
      contentType: "image/png",
    })),
  }
}

function makeOrgAccess() {
  return {
    findActiveOrganizationForEmail: vi.fn(async () => ({
      organizationId: "org-1",
      organizationName: "Example",
      organizationSlug: "example",
      domain: "example.com",
    })),
    ensureMember: vi.fn(async () => undefined),
    listMembershipsForUser: vi.fn(async () => []),
    hasMembership: vi.fn(async () => true),
    setActiveOrganizationForSession: vi.fn(async () => undefined),
  }
}

describe("createApiApp", () => {
  it("declares API dependencies and per-status response contracts through Elysia", () => {
    const app = createApiApp({
      config,
      repo: makeRepo(),
      linear: makeLinear(),
      orgAccess: makeOrgAccess(),
      auth: { getSession: vi.fn(async () => session) },
    })

    const appSingleton = app as unknown as {
      singleton: { decorator: Record<string, unknown> }
    }
    expect(appSingleton.singleton.decorator.resolveApiDependencies).toEqual(
      expect.any(Function)
    )

    const responseStatuses = (method: string, path: string) => {
      const route = app.routes.find(
        (candidate) => candidate.method === method && candidate.path === path
      )
      expect(route, `${method} ${path}`).toBeDefined()
      return Object.keys(route?.hooks.response ?? {}).sort()
    }

    expect(responseStatuses("GET", "/api/requests")).toEqual([
      "200",
      "401",
      "403",
      "409",
    ])
    expect(responseStatuses("GET", "/api/teams")).toEqual([
      "200",
      "401",
      "403",
      "409",
    ])
    expect(responseStatuses("POST", "/api/requests")).toEqual([
      "201",
      "400",
      "401",
      "403",
      "409",
    ])
    expect(responseStatuses("GET", "/api/requests/:id")).toEqual([
      "200",
      "401",
      "403",
      "404",
      "409",
    ])
    expect(responseStatuses("POST", "/api/requests/:id/comments")).toEqual([
      "201",
      "400",
      "401",
      "403",
      "404",
      "409",
    ])
    expect(responseStatuses("POST", "/api/requests/:id/close")).toEqual([
      "200",
      "400",
      "401",
      "403",
      "404",
      "409",
    ])
    expect(responseStatuses("POST", "/api/requests/:id/severity")).toEqual([
      "200",
      "400",
      "401",
      "403",
      "404",
      "409",
    ])
    expect(responseStatuses("POST", "/api/requests/:id/update")).toEqual([
      "200",
      "400",
      "401",
      "403",
      "404",
      "409",
    ])
    expect(responseStatuses("POST", "/api/uploads")).toEqual([
      "201",
      "400",
      "401",
      "403",
      "409",
      "413",
    ])
    expect(responseStatuses("POST", "/api/linear/webhook")).toEqual([
      "200",
      "400",
    ])
    expect(responseStatuses("GET", "/api/cron/reconcile")).toEqual([
      "200",
      "401",
    ])
    expect(responseStatuses("POST", "/api/slack/commands")).toEqual([
      "200",
      "400",
      "401",
      "404",
    ])
    expect(responseStatuses("POST", "/api/slack/interactivity")).toEqual([
      "200",
      "401",
      "404",
    ])
    expect(responseStatuses("POST", "/api/slack/events")).toEqual([
      "200",
      "401",
      "404",
    ])
  })

  it("mounts the Better Auth handler under the Elysia API app", async () => {
    const authHandler = vi.fn(async (request: Request) => {
      return Response.json({ path: new URL(request.url).pathname })
    })
    const app = createApiApp({
      config,
      repo: makeRepo(),
      linear: makeLinear(),
      orgAccess: makeOrgAccess(),
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
      ...makeLinear(),
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
    }
    const app = createApiApp({
      config,
      repo,
      linear,
      orgAccess: makeOrgAccess(),
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
      teamId: "team-id",
      priority: 2,
    })
    expect(repo.createRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        requesterUserId: "user-id",
        requesterEmail: "person@example.com",
        organizationId: "org-1",
        source: "web",
      })
    )
  })

  it("rejects authenticated users outside any approved organization", async () => {
    const app = createApiApp({
      config,
      repo: makeRepo(),
      linear: makeLinear(),
      auth: { getSession: vi.fn(async () => session) },
      orgAccess: {
        ...makeOrgAccess(),
        findActiveOrganizationForEmail: vi.fn(async () => null),
        hasMembership: vi.fn(async () => false),
      },
    })

    const response = await app.fetch(
      new Request("http://localhost/api/requests")
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: "forbidden_org" })
  })

  it("rejects authenticated users with multiple organizations to choose from", async () => {
    const app = createApiApp({
      config,
      repo: makeRepo(),
      linear: makeLinear(),
      auth: { getSession: vi.fn(async () => session) },
      orgAccess: {
        ...makeOrgAccess(),
        findActiveOrganizationForEmail: vi.fn(async () => null),
        hasMembership: vi.fn(async () => false),
        listMembershipsForUser: vi.fn(async () => [
          { organizationId: "org-1", role: "member" },
          { organizationId: "org-2", role: "member" },
        ]),
      },
    })

    const response = await app.fetch(
      new Request("http://localhost/api/requests")
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: "multiple_organizations",
    })
  })

  it("lists requests for the resolved organization", async () => {
    const repo = makeRepo()
    const app = createApiApp({
      config,
      repo,
      linear: makeLinear(),
      auth: { getSession: vi.fn(async () => session) },
      orgAccess: makeOrgAccess(),
    })

    const response = await app.fetch(
      new Request("http://localhost/api/requests")
    )

    expect(response.status).toBe(200)
    expect(repo.listRequestsForOrganization).toHaveBeenCalledWith("org-1", {
      page: 0,
      pageSize: 20,
      status: "all",
      severity: [],
    })
  })

  it("does not process the same Linear webhook event twice", async () => {
    const repo = makeRepo()
    vi.mocked(repo.applyWebhookEvent).mockResolvedValue(false)
    const app = createApiApp({
      config,
      repo,
      linear: makeLinear(),
      orgAccess: makeOrgAccess(),
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

  it("passes bounded pagination and filters to the organization's query", async () => {
    const repo = makeRepo()
    const app = createApiApp({
      config,
      repo,
      linear: makeLinear(),
      auth: { getSession: vi.fn(async () => session) },
      orgAccess: makeOrgAccess(),
    })
    const response = await app.fetch(
      new Request(
        "http://localhost/api/requests?page=2&pageSize=10&status=done&severity=1,3"
      )
    )
    expect(response.status).toBe(200)
    expect(repo.listRequestsForOrganization).toHaveBeenCalledWith("org-1", {
      page: 2,
      pageSize: 10,
      status: "done",
      severity: [1, 3],
    })
    const body = await response.json()
    expect(body).toMatchObject({ total: 1, page: 2, pageSize: 10 })
    expect(body.requests[0]).not.toHaveProperty("description")
    expect(body.requests[0]).not.toHaveProperty("requesterEmail")
  })

  it.each([
    "page=-1",
    "page=0.5",
    "pageSize=0",
    "pageSize=101",
    "status=other",
    "severity=5",
  ])("rejects invalid list parameters: %s", async (query) => {
    const repo = makeRepo()
    const app = createApiApp({
      config,
      repo,
      linear: makeLinear(),
      auth: { getSession: vi.fn(async () => session) },
      orgAccess: makeOrgAccess(),
    })
    const response = await app.fetch(
      new Request(`http://localhost/api/requests?${query}`)
    )
    expect(response.status).toBe(422)
    expect(repo.listRequestsForOrganization).not.toHaveBeenCalled()
  })

  it("notifies the request creator when a Linear user comments", async () => {
    const repo = makeRepo()
    vi.mocked(repo.getRequestByLinearIssueId).mockResolvedValue(
      makeRecord({
        source: "slack",
        slackChannelId: "C1",
        slackMessageTs: "123.45",
      })
    )
    const slack = makeSlack()
    const app = createApiApp({
      config: {
        ...config,
        slack: { signingSecret: "sign", botToken: "xoxb" },
      },
      repo,
      linear: makeLinear(),
      slack,
      orgAccess: makeOrgAccess(),
      auth: { getSession: vi.fn(async () => session) },
      verifyWebhook: vi.fn(async () => ({
        type: "Comment",
        action: "create",
        webhookId: "webhook-id",
        webhookTimestamp: 2,
        actor: { type: "user", name: "Linear Teammate" },
        data: {
          id: "comment-2",
          issueId: "linear-issue-id",
          body: "Please try the fix in staging.",
        },
      })),
    })

    const response = await app.fetch(
      new Request("http://localhost/api/linear/webhook", {
        method: "POST",
        body: "{}",
      })
    )

    expect(response.status).toBe(200)
    expect(slack.postMessage).toHaveBeenCalledWith({
      channel: "C1",
      threadTs: "123.45",
      text: expect.stringContaining("Please try the fix in staging."),
    })
    expect(repo.applyWebhookEvent).toHaveBeenCalledWith({
      eventKey: expect.any(String),
      linearIssueId: "linear-issue-id",
      rawBodyHash: expect.any(String),
      snapshot: null,
    })
  })

  it("returns Linear comments with a request detail", async () => {
    const repo = makeRepo()
    const linear = {
      ...makeLinear(),
      listIssueComments: vi.fn(async () => [
        {
          id: "activity-comment",
          body: "Is it? Where? What?",
          authorName: "adam.sobotka",
          createdAt: new Date("2026-01-01T00:30:00.000Z"),
        },
      ]),
    }
    const app = createApiApp({
      config,
      repo,
      linear,
      orgAccess: makeOrgAccess(),
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
            id: "activity-comment",
            body: "Is it? Where? What?",
            authorName: "adam.sobotka",
            createdAt: "2026-01-01T00:30:00.000Z",
          },
        ],
      },
    })
    expect(linear.listIssueComments).toHaveBeenCalledWith("linear-issue-id")
    expect(repo.getRequestForOrganization).toHaveBeenCalledWith(
      "request-id",
      "org-1"
    )
  })

  it("creates requester replies as Linear comments", async () => {
    const repo = makeRepo()
    const linear = {
      ...makeLinear(),
      createIssueComment: vi.fn(async () => ({
        id: "reply-id",
        body: "Requester: person@example.com\n\nIs it still broken?",
        authorName: "Desk",
        createdAt: new Date("2026-01-01T00:45:00.000Z"),
      })),
    }
    const app = createApiApp({
      config,
      repo,
      linear,
      orgAccess: makeOrgAccess(),
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
    expect(repo.getRequestForOrganization).toHaveBeenCalledWith(
      "request-id",
      "org-1"
    )
  })

  it("hides the details comment from the activity timeline", async () => {
    const repo = makeRepo()
    const linear = {
      ...makeLinear(),
      listIssueComments: vi.fn(async () => [
        {
          id: "comment-id",
          body: "Requester: person@example.com\n\n---\nLinearDesk details comment: linear-issue-id",
          authorName: "Desk",
          createdAt: new Date("2026-01-01T00:10:00.000Z"),
        },
        {
          id: "activity-comment",
          body: "A real reply",
          authorName: "Agent",
          createdAt: new Date("2026-01-01T00:30:00.000Z"),
        },
      ]),
    }
    const app = createApiApp({
      config,
      repo,
      linear,
      orgAccess: makeOrgAccess(),
      auth: { getSession: vi.fn(async () => session) },
    })

    const response = await app.fetch(
      new Request("http://localhost/api/requests/request-id")
    )

    const data = (await response.json()) as {
      request: { comments: { id: string }[] }
    }
    expect(data.request.comments.map((comment) => comment.id)).toEqual([
      "activity-comment",
    ])
    expect(repo.getRequestForOrganization).toHaveBeenCalledWith(
      "request-id",
      "org-1"
    )
  })

  it("closes the request with the chosen resolution", async () => {
    const repo = makeRepo()
    const linear = {
      ...makeLinear(),
      closeIssue: vi.fn(async () => ({
        id: "canceled-state",
        name: "Canceled",
        type: "canceled",
      })),
    }
    const app = createApiApp({
      config,
      repo,
      linear,
      orgAccess: makeOrgAccess(),
      auth: { getSession: vi.fn(async () => session) },
    })

    const response = await app.fetch(
      new Request("http://localhost/api/requests/request-id/close", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resolution: "canceled" }),
      })
    )

    expect(response.status).toBe(200)
    expect(linear.closeIssue).toHaveBeenCalledWith({
      issueId: "linear-issue-id",
      teamId: "team-id",
      resolution: "canceled",
    })
    expect(repo.updateRequestFromLinear).toHaveBeenCalled()
    expect(repo.getRequestForOrganization).toHaveBeenCalledWith(
      "request-id",
      "org-1"
    )
  })

  it("returns 404 without Linear side effects when closing a request outside the organization", async () => {
    const repo = makeRepo()
    repo.getRequestForOrganization = vi.fn(async () => null)
    const linear = {
      ...makeLinear(),
      closeIssue: vi.fn(),
    }
    const app = createApiApp({
      config,
      repo,
      linear,
      orgAccess: makeOrgAccess(),
      auth: { getSession: vi.fn(async () => session) },
    })

    const response = await app.fetch(
      new Request("http://localhost/api/requests/request-id/close", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resolution: "canceled" }),
      })
    )

    expect(response.status).toBe(404)
    expect(repo.getRequestForOrganization).toHaveBeenCalledWith(
      "request-id",
      "org-1"
    )
    expect(linear.closeIssue).not.toHaveBeenCalled()
    expect(repo.updateRequestFromLinear).not.toHaveBeenCalled()
  })

  it("rejects an invalid close resolution", async () => {
    const app = createApiApp({
      config,
      repo: makeRepo(),
      linear: makeLinear(),
      orgAccess: makeOrgAccess(),
      auth: { getSession: vi.fn(async () => session) },
    })

    const response = await app.fetch(
      new Request("http://localhost/api/requests/request-id/close", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resolution: "deleted" }),
      })
    )

    expect(response.status).toBe(400)
  })

  it("updates a request's fields for its owner", async () => {
    const repo = makeRepo()
    const linear = makeLinear()
    const app = createApiApp({
      config,
      repo,
      linear,
      orgAccess: makeOrgAccess(),
      auth: { getSession: vi.fn(async () => session) },
    })
    const res = await app.fetch(
      new Request("http://localhost/api/requests/request-id/update", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "Edited title",
          description: "Expected\n\nCurrent\n\nSteps",
          severity: "urgent",
        }),
      })
    )
    expect(res.status).toBe(200)
    expect(linear.updateIssueFields).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Edited title", priority: 1 })
    )
    expect(repo.updateRequestFields).toHaveBeenCalled()
    expect(repo.getRequestForOrganization).toHaveBeenCalledWith(
      "request-id",
      "org-1"
    )
  })

  it("atomically updates severity on open or closed requests", async () => {
    const repo = makeRepo()
    repo.getRequestForOrganization = vi.fn(async () =>
      makeRecord({ linearStateType: "completed" })
    )
    const linear = makeLinear()
    const app = createApiApp({
      config,
      repo,
      linear,
      orgAccess: makeOrgAccess(),
      auth: { getSession: vi.fn(async () => session) },
    })

    const res = await app.fetch(
      new Request("http://localhost/api/requests/request-id/severity", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ severity: 1 }),
      })
    )

    expect(res.status).toBe(200)
    expect(linear.updateIssuePriority).toHaveBeenCalledWith({
      issueId: "linear-issue-id",
      priority: 1,
    })
    expect(repo.updateRequestSeverity).toHaveBeenCalledWith({
      id: "request-id",
      severity: 1,
    })
    expect(linear.updateIssueFields).not.toHaveBeenCalled()
    expect(repo.updateRequestFields).not.toHaveBeenCalled()
  })

  it("rejects editing a closed ticket with 409", async () => {
    const repo = makeRepo()
    repo.getRequestForOrganization = vi.fn(async () =>
      makeRecord({ linearStateType: "completed" })
    )
    const app = createApiApp({
      config,
      repo,
      linear: makeLinear(),
      orgAccess: makeOrgAccess(),
      auth: { getSession: vi.fn(async () => session) },
    })
    const res = await app.fetch(
      new Request("http://localhost/api/requests/request-id/update", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "x".repeat(5),
          description: "d",
          severity: "low",
        }),
      })
    )
    expect(res.status).toBe(409)
    expect(repo.getRequestForOrganization).toHaveBeenCalledWith(
      "request-id",
      "org-1"
    )
  })
})

describe("POST /api/uploads", () => {
  function makeApp(overrides?: {
    uploadAsset?: LinearGateway["uploadAsset"]
    getSession?: AuthBridge["getSession"]
  }) {
    const linear = {
      ...makeLinear(),
      uploadAsset:
        overrides?.uploadAsset ??
        vi.fn(async () => ({ assetUrl: "https://uploads.linear.app/abc.png" })),
    }
    const app = createApiApp({
      config,
      repo: makeRepo(),
      linear,
      orgAccess: makeOrgAccess(),
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

describe("GET /api/requests/:id/assets", () => {
  const assetUrl = "https://uploads.linear.app/asset/shot.png"

  it("proxies an image referenced by an authorized request", async () => {
    const repo = makeRepo()
    vi.mocked(repo.getRequestForOrganization).mockResolvedValue(
      makeRecord({ description: `Screenshot\n![shot](${assetUrl})` })
    )
    const linear = {
      ...makeLinear(),
      downloadAsset: vi.fn(async () => ({
        bytes: new Uint8Array([1, 2, 3]),
        contentType: "image/png",
      })),
    }
    const app = createApiApp({
      config,
      repo,
      linear,
      orgAccess: makeOrgAccess(),
      auth: { getSession: vi.fn(async () => session) },
    })

    const response = await app.fetch(
      new Request(
        `http://localhost/api/requests/request-id/assets?url=${encodeURIComponent(assetUrl)}`
      )
    )

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("image/png")
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3])
    )
    expect(linear.downloadAsset).toHaveBeenCalledWith(assetUrl)
  })

  it("does not proxy an image absent from the request and its comments", async () => {
    const linear = {
      ...makeLinear(),
      downloadAsset: vi.fn(),
    }
    const app = createApiApp({
      config,
      repo: makeRepo(),
      linear,
      orgAccess: makeOrgAccess(),
      auth: { getSession: vi.fn(async () => session) },
    })

    const response = await app.fetch(
      new Request(
        `http://localhost/api/requests/request-id/assets?url=${encodeURIComponent(assetUrl)}`
      )
    )

    expect(response.status).toBe(404)
    expect(linear.downloadAsset).not.toHaveBeenCalled()
  })

  it("proxies an image referenced by a Linear comment", async () => {
    const linear = {
      ...makeLinear(),
      getIssueCommentBody: vi.fn(
        async () => `More evidence\n![shot](${assetUrl})`
      ),
      downloadAsset: vi.fn(async () => ({
        bytes: new Uint8Array([4, 5, 6]),
        contentType: "image/png",
      })),
    }
    const app = createApiApp({
      config,
      repo: makeRepo(),
      linear,
      orgAccess: makeOrgAccess(),
      auth: { getSession: vi.fn(async () => session) },
    })

    const response = await app.fetch(
      new Request(
        `http://localhost/api/requests/request-id/assets?commentId=comment-1&url=${encodeURIComponent(assetUrl)}`
      )
    )

    expect(response.status).toBe(200)
    expect(linear.downloadAsset).toHaveBeenCalledWith(assetUrl)
    expect(linear.getIssueCommentBody).toHaveBeenCalledWith(
      "linear-issue-id",
      "comment-1"
    )
    expect(linear.listIssueComments).not.toHaveBeenCalled()
  })

  it.each([null, "A comment with no image"])(
    "rejects an asset without an owning comment (%s)",
    async (body) => {
      const linear = {
        ...makeLinear(),
        getIssueCommentBody: vi.fn(async () => body),
      }
      const app = createApiApp({
        config,
        repo: makeRepo(),
        linear,
        orgAccess: makeOrgAccess(),
        auth: { getSession: vi.fn(async () => session) },
      })
      const response = await app.fetch(
        new Request(
          `http://localhost/api/requests/request-id/assets?commentId=foreign-comment&url=${encodeURIComponent(assetUrl)}`
        )
      )
      expect(response.status).toBe(404)
      expect(linear.getIssueCommentBody).toHaveBeenCalledWith(
        "linear-issue-id",
        "foreign-comment"
      )
      expect(linear.downloadAsset).not.toHaveBeenCalled()
      expect(linear.listIssueComments).not.toHaveBeenCalled()
    }
  )
})

describe("GET /api/cron/reconcile", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("rejects reconcile without the cron secret", async () => {
    vi.stubEnv("CRON_SECRET", "cron-secret")
    const app = createApiApp({
      config,
      repo: makeRepo(),
      linear: makeLinear(),
      orgAccess: makeOrgAccess(),
      auth: { getSession: vi.fn(async () => null) },
    })

    const response = await app.fetch(
      new Request("http://localhost/api/cron/reconcile")
    )

    expect(response.status).toBe(401)
  })

  it("reconciles open requests when the cron secret matches", async () => {
    vi.stubEnv("CRON_SECRET", "cron-secret")
    const repo = makeRepo()
    const app = createApiApp({
      config,
      repo,
      linear: makeLinear(),
      orgAccess: makeOrgAccess(),
      auth: { getSession: vi.fn(async () => null) },
    })

    const response = await app.fetch(
      new Request("http://localhost/api/cron/reconcile", {
        headers: { authorization: "Bearer cron-secret" },
      })
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ ok: true })
    expect(repo.listOpenRequests).toHaveBeenCalled()
  })
})
