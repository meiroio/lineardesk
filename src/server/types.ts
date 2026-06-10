export type AppConfig = {
  allowedEmailDomains: string[]
  databaseUrl: string
  betterAuthSecret: string
  betterAuthUrl: string
  googleClientId: string
  googleClientSecret: string
  linear: {
    apiKey: string
    teamId: string
    teamKey: string
    initialStateName: string
    labelName: string
    webhookSecret: string
  }
}

export type AuthSession = {
  user: {
    id: string
    email: string
    name?: string | null
  }
}

export type LinearIssueStateSnapshot = {
  id: string
  name: string
  type: string
}

export type LinearIssueSnapshot = {
  id: string
  identifier: string
  url: string
  detailsCommentId: string | null
  state: LinearIssueStateSnapshot
}

export type CreateHelpdeskIssueInput = {
  title: string
  description: string
  requesterEmail: string
}

export type LinearGateway = {
  createHelpdeskIssue: (
    input: CreateHelpdeskIssueInput
  ) => Promise<LinearIssueSnapshot>
  createHelpdeskIssueDetailsComment: (
    input: HelpdeskIssueDetailsCommentInput
  ) => Promise<LinearCommentSnapshot>
  createIssueComment: (
    input: CreateIssueCommentInput
  ) => Promise<LinearIssueCommentSnapshot>
  listIssueComments: (issueId: string) => Promise<LinearIssueCommentSnapshot[]>
}

export type HelpdeskIssueDetailsCommentInput = {
  issueId: string
  description: string
  requesterEmail: string
}

export type LinearCommentSnapshot = {
  id: string
}

export type CreateIssueCommentInput = {
  issueId: string
  body: string
}

export type LinearIssueCommentSnapshot = {
  id: string
  body: string
  authorName: string
  createdAt: Date
}

export type RequestRecord = {
  id: string
  requesterUserId: string
  requesterEmail: string
  title: string
  description: string
  linearIssueId: string
  linearIdentifier: string
  linearUrl: string
  linearTeamId: string
  linearStateId: string
  linearStateName: string
  linearStateType: string
  linearDetailsCommentId: string | null
  linearDetailsCommentedAt: Date | null
  createdAt: Date
  updatedAt: Date
  lastLinearSyncedAt: Date
}

export type CreateRequestRecordInput = {
  requesterUserId: string
  requesterEmail: string
  title: string
  description: string
  linearIssue: LinearIssueSnapshot
  linearTeamId: string
}

export type LinearIssueWebhookSnapshot = {
  linearIssueId: string
  linearIdentifier: string
  linearUrl: string
  linearStateId: string
  linearStateName: string
  linearStateType: string
}

export type HelpdeskRepository = {
  createRequest: (input: CreateRequestRecordInput) => Promise<RequestRecord>
  listRequestsForUser: (userId: string) => Promise<RequestRecord[]>
  getRequestForUser: (
    id: string,
    userId: string
  ) => Promise<RequestRecord | null>
  listRequestsMissingDetailsComment: (limit: number) => Promise<RequestRecord[]>
  markDetailsCommentCreated: (id: string, commentId: string) => Promise<void>
  hasProcessedWebhookEvent: (eventKey: string) => Promise<boolean>
  recordWebhookEvent: (
    eventKey: string,
    linearIssueId: string | null,
    rawBodyHash: string
  ) => Promise<void>
  updateRequestFromLinear: (
    snapshot: LinearIssueWebhookSnapshot
  ) => Promise<void>
}

export type VerifyWebhook = (input: {
  rawBody: string
  signature: string | null
  timestamp: string | null
}) => Promise<unknown> | unknown

export type AuthBridge = {
  handler?: (request: Request) => Promise<Response> | Response
  getSession: (headers: Headers) => Promise<AuthSession | null>
}
