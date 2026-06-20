export type EmailConfig = {
  provider: "log" | "resend"
  appName: string
  from: string
  resendApiKey?: string
}

export type AppConfig = {
  email: EmailConfig
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
  slack?: {
    signingSecret: string
    botToken: string
  }
  gemini?: {
    apiKey: string
    model: string
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

export type IssueStateSnapshot = {
  id: string
  identifier: string
  url: string
  state: LinearIssueStateSnapshot
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
  priority?: number
}

export type UploadAssetInput = {
  contentType: string
  filename: string
  bytes: Uint8Array
}

export type UploadAssetResult = {
  assetUrl: string
}

export type CloseIssueResolution = "resolved" | "canceled"

export type CloseIssueInput = {
  issueId: string
  resolution: CloseIssueResolution
}

export type LinearGateway = {
  createHelpdeskIssue: (
    input: CreateHelpdeskIssueInput
  ) => Promise<LinearIssueSnapshot>
  createIssueComment: (
    input: CreateIssueCommentInput
  ) => Promise<LinearIssueCommentSnapshot>
  listIssueComments: (issueId: string) => Promise<LinearIssueCommentSnapshot[]>
  listIssueStates: (issueIds: string[]) => Promise<IssueStateSnapshot[]>
  uploadAsset: (input: UploadAssetInput) => Promise<UploadAssetResult>
  closeIssue: (input: CloseIssueInput) => Promise<LinearIssueStateSnapshot>
  updateIssueFields: (input: {
    issueId: string
    title: string
    description: string
    priority: number
  }) => Promise<void>
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

export type SlackFileRef = {
  id: string
  name: string
  mimetype: string
  urlPrivate: string
}

export type SlackGateway = {
  openView: (triggerId: string, view: unknown) => Promise<string>
  updateView: (viewId: string, view: unknown) => Promise<void>
  postMessage: (input: {
    channel: string
    threadTs?: string
    text: string
  }) => Promise<{ channel: string; ts: string }>
  getUserEmail: (userId: string) => Promise<string | null>
  getPermalink: (input: {
    channel: string
    messageTs: string
  }) => Promise<string>
  getThreadReplies: (input: {
    channel: string
    threadTs: string
  }) => Promise<{
    messages: { user: string | null; text: string; files: SlackFileRef[] }[]
  }>
  downloadFile: (
    urlPrivate: string
  ) => Promise<{ bytes: Uint8Array; contentType: string }>
}

export type RequestRecord = {
  id: string
  requesterUserId: string | null
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
  severity: number | null
  linearDetailsCommentId: string | null
  linearDetailsCommentedAt: Date | null
  createdAt: Date
  updatedAt: Date
  lastLinearSyncedAt: Date
  source: "web" | "slack"
  slackChannelId: string | null
  slackMessageTs: string | null
}

export type CreateRequestRecordInput = {
  requesterUserId: string | null
  requesterEmail: string
  title: string
  description: string
  severity: number
  linearIssue: LinearIssueSnapshot
  linearTeamId: string
  source?: "web" | "slack"
  slackChannelId?: string | null
  slackMessageTs?: string | null
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
  getUserIdByEmail: (email: string) => Promise<string | null>
  listRequestsForEmail: (email: string) => Promise<RequestRecord[]>
  getRequestForEmail: (
    id: string,
    email: string
  ) => Promise<RequestRecord | null>
  listOpenRequests: (limit: number) => Promise<RequestRecord[]>
  hasProcessedWebhookEvent: (eventKey: string) => Promise<boolean>
  recordWebhookEvent: (
    eventKey: string,
    linearIssueId: string | null,
    rawBodyHash: string
  ) => Promise<void>
  hasProcessedSlackEvent: (eventId: string) => Promise<boolean>
  recordSlackEvent: (eventId: string) => Promise<void>
  updateRequestFromLinear: (
    snapshot: LinearIssueWebhookSnapshot
  ) => Promise<void>
  updateRequestFields: (input: {
    id: string
    title: string
    description: string
    severity: number
  }) => Promise<RequestRecord | null>
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

export type TicketDraft = {
  title: string
  expectedBehaviour: string
  currentBehaviour: string
  stepsToReproduce: string
}

export type GeminiGateway = {
  extractTicketDraft: (transcript: string) => Promise<TicketDraft>
}
