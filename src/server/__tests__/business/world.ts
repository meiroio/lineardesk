import { createHmac } from "node:crypto"

import { createApiApp } from "../../app"
import { getEmailDomain } from "../../org-access"
import type {
  AppConfig,
  AuthBridge,
  AuthSession,
  CloseIssueResolution,
  CreateRequestRecordInput,
  GeminiGateway,
  HelpdeskRepository,
  IssueStateSnapshot,
  LinearGateway,
  LinearIssueCommentSnapshot,
  LinearIssueSnapshot,
  LinearIssueStateSnapshot,
  OrgAccessRepository,
  OrganizationAccessRecord,
  OrganizationMembershipRecord,
  RequestRecord,
  SlackGateway,
  SlackFileRef,
  TicketDraft,
} from "../../types"

const BASE_TIME = Date.parse("2026-01-01T00:00:00.000Z")

type OrganizationInput = {
  id: string
  name: string
  slug: string
  domains: string[]
}

type TestUserInput = {
  id: string
  email: string
  name?: string | null
  activeOrganizationId?: string | null
}

type MembershipInput = {
  userId: string
  organizationId: string
  role?: OrganizationMembershipRecord["role"]
}

type TestIssue = LinearIssueSnapshot & {
  title: string
  description: string
  requesterEmail: string
  priority?: number
}

type SlackThreadMessage = {
  user: string | null
  text: string
  files?: SlackFileRef[]
}

export function makeBusinessWorld() {
  let requestSequence = 0
  let issueSequence = 100
  let commentSequence = 0
  let assetSequence = 0
  let clock = BASE_TIME

  const requests = new Map<string, RequestRecord>()
  const issues = new Map<string, TestIssue>()
  const issueComments = new Map<string, LinearIssueCommentSnapshot[]>()
  const webhookEvents = new Set<string>()
  const slackEvents = new Set<string>()
  const userIdsByEmail = new Map<string, string>()
  const sessions = new Map<string, AuthSession>()
  const organizationsById = new Map<string, OrganizationAccessRecord>()
  const organizationsByDomain = new Map<string, OrganizationAccessRecord>()
  const membershipsByUser = new Map<string, OrganizationMembershipRecord[]>()
  const slackUserEmails = new Map<string, string | null>()
  const slackThreads = new Map<
    string,
    { user: string | null; text: string; files: SlackFileRef[] }[]
  >()
  const slackPosts: { channel: string; threadTs?: string; text: string }[] = []
  const linearCreateInputs: {
    title: string
    description: string
    requesterEmail: string
    priority?: number
  }[] = []

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
    slack: {
      signingSecret: "slack-signing-secret",
      botToken: "xoxb-test",
    },
    gemini: {
      apiKey: "gemini-key",
      model: "gemini-test",
    },
  }

  const now = () => {
    clock += 1_000
    return new Date(clock)
  }

  const initialState = (): LinearIssueStateSnapshot => ({
    id: "state-triage",
    name: "Triage",
    type: "triage",
  })

  const terminalState = (
    resolution: CloseIssueResolution
  ): LinearIssueStateSnapshot =>
    resolution === "resolved"
      ? { id: "state-completed", name: "Done", type: "completed" }
      : { id: "state-canceled", name: "Canceled", type: "canceled" }

  const repo: HelpdeskRepository = {
    createRequest: async (input: CreateRequestRecordInput) => {
      const createdAt = now()
      const record: RequestRecord = {
        id: `request-${++requestSequence}`,
        requesterUserId: input.requesterUserId,
        organizationId: input.organizationId,
        requesterEmail: input.requesterEmail,
        title: input.title,
        description: input.description,
        linearIssueId: input.linearIssue.id,
        linearIdentifier: input.linearIssue.identifier,
        linearUrl: input.linearIssue.url,
        linearTeamId: input.linearTeamId,
        linearStateId: input.linearIssue.state.id,
        linearStateName: input.linearIssue.state.name,
        linearStateType: input.linearIssue.state.type,
        severity: input.severity,
        linearDetailsCommentId: input.linearIssue.detailsCommentId,
        linearDetailsCommentedAt: input.linearIssue.detailsCommentId
          ? createdAt
          : null,
        createdAt,
        updatedAt: createdAt,
        lastLinearSyncedAt: createdAt,
        source: input.source ?? "web",
        slackChannelId: input.slackChannelId ?? null,
        slackMessageTs: input.slackMessageTs ?? null,
      }
      requests.set(record.id, record)
      return record
    },
    getUserIdByEmail: async (email: string) =>
      userIdsByEmail.get(email) ?? null,
    listRequestsForOrganization: async (organizationId, query) => {
      const matching = Array.from(requests.values())
        .filter((request) => request.organizationId === organizationId)
        .filter((request) => {
          const done = ["completed", "canceled", "duplicate"].includes(
            request.linearStateType
          )
          return (
            (query.status === "all" || done === (query.status === "done")) &&
            (!query.severity.length ||
              (request.severity !== null &&
                query.severity.includes(request.severity)))
          )
        })
        .sort(
          (left, right) =>
            right.createdAt.getTime() - left.createdAt.getTime() ||
            right.id.localeCompare(left.id)
        )
      return {
        requests: matching.slice(
          query.page * query.pageSize,
          (query.page + 1) * query.pageSize
        ),
        total: matching.length,
      }
    },
    getRequestForOrganization: async (id: string, organizationId: string) => {
      const request = requests.get(id)
      return request?.organizationId === organizationId ? request : null
    },
    getRequestByLinearIssueId: async (linearIssueId: string) =>
      Array.from(requests.values()).find(
        (request) => request.linearIssueId === linearIssueId
      ) ?? null,
    listOpenRequests: async (limit: number) =>
      Array.from(requests.values())
        .filter(
          (request) =>
            !["completed", "canceled", "duplicate"].includes(
              request.linearStateType
            )
        )
        .sort(
          (left, right) =>
            left.lastLinearSyncedAt.getTime() -
              right.lastLinearSyncedAt.getTime() ||
            left.id.localeCompare(right.id)
        )
        .slice(0, limit),
    markRequestsSynced: async (issueIds, checkedAt) => {
      for (const request of requests.values()) {
        if (issueIds.includes(request.linearIssueId))
          request.lastLinearSyncedAt = checkedAt
      }
    },
    applyWebhookEvent: async ({ eventKey, snapshot }) => {
      if (webhookEvents.has(eventKey)) return false
      webhookEvents.add(eventKey)
      if (snapshot) await repo.updateRequestFromLinear(snapshot)
      return true
    },
    claimSlackEvent: async (eventId) => {
      if (slackEvents.has(eventId)) return false
      slackEvents.add(eventId)
      return true
    },
    releaseSlackEvent: async (eventId) => {
      slackEvents.delete(eventId)
    },
    updateRequestFromLinear: async (snapshot) => {
      const record = Array.from(requests.values()).find(
        (request) => request.linearIssueId === snapshot.linearIssueId
      )
      if (!record) return

      const updatedAt = now()
      requests.set(record.id, {
        ...record,
        linearIdentifier: snapshot.linearIdentifier,
        linearUrl: snapshot.linearUrl,
        linearStateId: snapshot.linearStateId,
        linearStateName: snapshot.linearStateName,
        linearStateType: snapshot.linearStateType,
        lastLinearSyncedAt: updatedAt,
        updatedAt,
      })
    },
    updateRequestFields: async (input) => {
      const record = requests.get(input.id)
      if (!record) return null

      const updated: RequestRecord = {
        ...record,
        title: input.title,
        description: input.description,
        severity: input.severity,
        updatedAt: now(),
      }
      requests.set(updated.id, updated)
      return updated
    },
    updateRequestSeverity: async (input) => {
      const record = requests.get(input.id)
      if (!record) return null

      const updated: RequestRecord = {
        ...record,
        severity: input.severity,
        updatedAt: now(),
      }
      requests.set(updated.id, updated)
      return updated
    },
  }

  const linear: LinearGateway = {
    listTeams: async () => [
      { id: "team-id", key: "BAS", name: "Base" },
      { id: "team-product", key: "PRD", name: "Product" },
    ],
    createHelpdeskIssue: async (input): Promise<LinearIssueSnapshot> => {
      linearCreateInputs.push(input)
      const sequence = ++issueSequence
      const issue: TestIssue = {
        id: `linear-${sequence}`,
        identifier: `BAS-${sequence}`,
        url: `https://linear.app/base/issue/BAS-${sequence}`,
        detailsCommentId: null,
        state: initialState(),
        title: input.title,
        description: input.description,
        requesterEmail: input.requesterEmail,
        priority: input.priority,
      }
      issues.set(issue.id, issue)
      issueComments.set(issue.id, [])
      return issue
    },
    createIssueComment: async (input) => {
      const comment: LinearIssueCommentSnapshot = {
        id: `comment-${++commentSequence}`,
        body: input.body,
        authorName: "LinearDesk",
        createdAt: now(),
      }
      issueComments.set(input.issueId, [
        ...(issueComments.get(input.issueId) ?? []),
        comment,
      ])
      return comment
    },
    listIssueComments: async (issueId: string) =>
      issueComments.get(issueId) ?? [],
    getIssueCommentBody: async (issueId, commentId) =>
      issueComments.get(issueId)?.find((comment) => comment.id === commentId)
        ?.body ?? null,
    listIssueStates: async (
      issueIds: string[]
    ): Promise<IssueStateSnapshot[]> =>
      issueIds.flatMap((issueId) => {
        const issue = issues.get(issueId)
        return issue
          ? [
              {
                id: issue.id,
                identifier: issue.identifier,
                url: issue.url,
                state: issue.state,
              },
            ]
          : []
      }),
    uploadAsset: async () => ({
      assetUrl: `https://uploads.linear.app/test-${++assetSequence}.png`,
    }),
    downloadAsset: async () => ({
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "image/png",
    }),
    closeIssue: async (input) => {
      const issue = issues.get(input.issueId)
      if (!issue) throw new Error(`Unknown issue ${input.issueId}`)

      const state = terminalState(input.resolution)
      issues.set(issue.id, { ...issue, state })
      return state
    },
    updateIssueFields: async (input) => {
      const issue = issues.get(input.issueId)
      if (!issue) throw new Error(`Unknown issue ${input.issueId}`)

      issues.set(issue.id, {
        ...issue,
        title: input.title,
        description: input.description,
        priority: input.priority,
      })
    },
    updateIssuePriority: async (input) => {
      const issue = issues.get(input.issueId)
      if (!issue) throw new Error(`Unknown issue ${input.issueId}`)

      issues.set(issue.id, { ...issue, priority: input.priority })
    },
  }

  const orgAccess: OrgAccessRepository = {
    findActiveOrganizationForEmail: async (email) => {
      const domain = getEmailDomain(email)
      return domain ? (organizationsByDomain.get(domain) ?? null) : null
    },
    ensureMember: async (input) => {
      const memberships = membershipsByUser.get(input.userId) ?? []
      if (
        !memberships.some(
          (membership) => membership.organizationId === input.organizationId
        )
      ) {
        memberships.push({
          organizationId: input.organizationId,
          role: input.role,
        })
      }
      membershipsByUser.set(input.userId, memberships)
    },
    listMembershipsForUser: async (userId) =>
      membershipsByUser.get(userId) ?? [],
    hasMembership: async (userId, organizationId) =>
      (membershipsByUser.get(userId) ?? []).some(
        (membership) => membership.organizationId === organizationId
      ),
    setActiveOrganizationForSession: async (input) => {
      const session = sessions.get(input.sessionToken)
      if (!session) return
      sessions.set(input.sessionToken, {
        ...session,
        activeOrganizationId: input.organizationId,
      })
    },
  }

  const auth: AuthBridge = {
    getSession: async (headers) => {
      const token = headers.get("x-test-session")
      return token ? (sessions.get(token) ?? null) : null
    },
  }

  const slack: SlackGateway = {
    openView: async () => "view-1",
    updateView: async () => {},
    postMessage: async (input) => {
      slackPosts.push(input)
      return { channel: input.channel, ts: `post-${slackPosts.length}` }
    },
    getUserEmail: async (userId) => slackUserEmails.get(userId) ?? null,
    findUserIdByEmail: async (email) =>
      Array.from(slackUserEmails.entries()).find(
        ([, userEmail]) => userEmail === email
      )?.[0] ?? null,
    getPermalink: async (input) =>
      `https://acme.slack.com/archives/${input.channel}/p${input.messageTs.replace(".", "")}`,
    getThreadReplies: async (input) => ({
      messages:
        slackThreads.get(slackThreadKey(input.channel, input.threadTs)) ?? [],
    }),
    downloadFile: async () => ({
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "image/png",
    }),
  }

  const gemini: GeminiGateway = {
    extractTicketDraft: async (): Promise<TicketDraft> => ({
      title: "CSV export fails",
      expectedBehaviour: "The CSV export downloads successfully.",
      currentBehaviour: "The export returns a 500 error.",
      stepsToReproduce: "Open reports and click Export CSV.",
      severity: "medium",
    }),
  }

  const app = createApiApp({
    config,
    repo,
    linear,
    auth,
    orgAccess,
    slack,
    gemini,
    verifyWebhook: ({ rawBody }) => JSON.parse(rawBody),
  })

  return {
    app,
    config,
    repo,
    linear,
    slack,
    gemini,
    requests,
    issues,
    issueComments,
    linearCreateInputs,
    slackPosts,
    getLinearIssue(issueId: string) {
      return issues.get(issueId) ?? null
    },
    setLinearIssueState(issueId: string, state: LinearIssueStateSnapshot) {
      const issue = issues.get(issueId)
      if (!issue) throw new Error(`Unknown issue ${issueId}`)
      issues.set(issue.id, { ...issue, state })
    },
    addOrganization(input: OrganizationInput) {
      const record: OrganizationAccessRecord = {
        organizationId: input.id,
        organizationName: input.name,
        organizationSlug: input.slug,
        domain: input.domains[0] ?? "",
      }
      organizationsById.set(input.id, record)
      for (const domain of input.domains) {
        organizationsByDomain.set(domain, { ...record, domain })
      }
    },
    addMembership(input: MembershipInput) {
      const memberships = membershipsByUser.get(input.userId) ?? []
      memberships.push({
        organizationId: input.organizationId,
        role: input.role ?? "member",
      })
      membershipsByUser.set(input.userId, memberships)
    },
    signIn(input: TestUserInput) {
      userIdsByEmail.set(input.email, input.id)
      const token = `session-${sessions.size + 1}`
      sessions.set(token, {
        user: {
          id: input.id,
          email: input.email,
          name: input.name ?? input.email,
        },
        activeOrganizationId: input.activeOrganizationId ?? null,
        sessionToken: token,
      })
      if (input.activeOrganizationId) {
        const memberships = membershipsByUser.get(input.id) ?? []
        memberships.push({
          organizationId: input.activeOrganizationId,
          role: "member",
        })
        membershipsByUser.set(input.id, memberships)
      }
      return token
    },
    setSlackUserEmail(userId: string, email: string | null) {
      slackUserEmails.set(userId, email)
    },
    setSlackThread(
      channel: string,
      threadTs: string,
      messages: SlackThreadMessage[]
    ) {
      slackThreads.set(
        slackThreadKey(channel, threadTs),
        messages.map((message) => ({
          user: message.user,
          text: message.text,
          files: message.files ?? [],
        }))
      )
    },
    async get(path: string, sessionToken?: string) {
      return app.fetch(
        new Request(`http://localhost/api${path}`, {
          headers: sessionHeaders(sessionToken),
        })
      )
    },
    async reconcile(secret: string) {
      return app.fetch(
        new Request("http://localhost/api/cron/reconcile", {
          headers: {
            authorization: `Bearer ${secret}`,
          },
        })
      )
    },
    async postJson(path: string, body: unknown, sessionToken?: string) {
      return app.fetch(
        new Request(`http://localhost/api${path}`, {
          method: "POST",
          headers: {
            ...sessionHeaders(sessionToken),
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        })
      )
    },
    async postSlackEvent(payload: unknown) {
      const body = JSON.stringify(payload)
      const pending: Promise<unknown>[] = []
      const request = Object.assign(
        new Request("http://localhost/api/slack/events", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...slackSignatureHeaders(config.slack!.signingSecret, body),
          },
          body,
        }),
        { waitUntil: (work: Promise<unknown>) => pending.push(work) }
      )
      const response = await app.fetch(request)
      await Promise.all(pending)
      return response
    },
  }
}

function sessionHeaders(sessionToken?: string): Record<string, string> {
  return sessionToken ? { "x-test-session": sessionToken } : {}
}

function slackThreadKey(channel: string, threadTs: string) {
  return `${channel}:${threadTs}`
}

function slackSignatureHeaders(secret: string, body: string) {
  const timestamp = String(Math.floor(Date.now() / 1000))
  return {
    "x-slack-request-timestamp": timestamp,
    "x-slack-signature": `v0=${createHmac("sha256", secret)
      .update(`v0:${timestamp}:${body}`)
      .digest("hex")}`,
  }
}
