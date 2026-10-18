import { LinearClient } from "@linear/sdk"

import type {
  AppConfig,
  CloseIssueInput,
  CreateIssueCommentInput,
  CreateHelpdeskIssueInput,
  DownloadAssetResult,
  IssueStateSnapshot,
  LinearGateway,
  LinearIssueCommentSnapshot,
  LinearIssueSnapshot,
  LinearIssueStateSnapshot,
  LinearTeamSnapshot,
  LinearIssueAssignment,
  LinearAssigneeSnapshot,
  UploadAssetInput,
  UploadAssetResult,
} from "./types"

type WorkflowStateCandidate = {
  id: string
  name: string
  type: string
  teamId?: string
}

type IssueLabelCandidate = {
  id: string
  name: string
  teamId?: string
  isGroup?: boolean
}

type LinearGatewayConfig = AppConfig["linear"]
type LinearClientProvider = () => Promise<LinearClient>
type LinearAccessTokenProvider = () => Promise<string>
type LinearConnection = {
  client: LinearClient
  accessToken: string
  expiresAt: number
}
type LinearTeamsResponse = {
  teams: {
    nodes: Array<{
      id: string
      key: string
      displayName: string
      retiredAt: string | null
    }>
  }
}
type LinearCommentAuthor = {
  displayName?: string | null
  name?: string | null
}
type LinearCommentData = {
  id: string
  body: string
  createdAt: Date | string
  botActor?: { userDisplayName?: string | null; name?: string | null } | null
  user?: LinearCommentAuthor | PromiseLike<LinearCommentAuthor | null> | null
}
type LinearCommentsResponse = {
  comments: {
    nodes: LinearCommentData[]
    pageInfo: { hasNextPage: boolean; endCursor: string | null }
  }
}
type LinearIssueCreateInput = {
  title: string
  description: string
  teamId: string
  stateId: string
  labelIds?: string[]
  priority?: number
}

const LINEAR_OAUTH_TOKEN_URL = "https://api.linear.app/oauth/token"
const LINEAR_OAUTH_SCOPE = "read,write"
const LINEAR_TOKEN_REFRESH_BUFFER_MS = 60_000
const MAX_LINEAR_IMAGE_BYTES = 20 * 1024 * 1024

export function selectWorkflowStateByName<T extends WorkflowStateCandidate>(
  states: readonly T[],
  name: string,
  teamId: string
) {
  return (
    states.find((state) => {
      return state.name === name && state.teamId === teamId
    }) ?? null
  )
}

export function selectWorkflowStateByType<T extends WorkflowStateCandidate>(
  states: readonly T[],
  type: string,
  teamId: string
) {
  return (
    states.find((state) => state.type === type && state.teamId === teamId) ??
    null
  )
}

export function selectIssueLabelByName<T extends IssueLabelCandidate>(
  labels: readonly T[],
  name: string,
  teamId?: string
) {
  const matches = labels.filter(
    (label) => label.name === name && !label.isGroup
  )
  if (!teamId) return matches[0] ?? null

  return (
    matches.find((label) => label.teamId === teamId) ??
    matches.find((label) => !label.teamId) ??
    null
  )
}

export function requireIssueLabelByName<T extends IssueLabelCandidate>(
  labels: readonly T[],
  name: string,
  teamId: string
) {
  const label = selectIssueLabelByName(labels, name, teamId)
  if (!label)
    throw new Error(
      `Linear issue label "${name}" was not found for team ${teamId}`
    )

  return label
}

export function getDetailsCommentMarker(issueId: string) {
  return `LinearDesk details comment: ${issueId}`
}

export function buildLinearIssueInput(input: {
  title: string
  description: string
  requesterEmail: string
  teamId: string
  stateId: string
  labelId: string | null
  priority?: number
}): LinearIssueCreateInput {
  const issueInput: LinearIssueCreateInput = {
    title: input.title,
    description: `Requester: ${input.requesterEmail}\n\n${input.description}`,
    teamId: input.teamId,
    stateId: input.stateId,
  }

  if (input.labelId) issueInput.labelIds = [input.labelId]
  if (typeof input.priority === "number") issueInput.priority = input.priority

  return issueInput
}

export function buildRequesterReplyCommentBody(input: {
  requesterEmail: string
  body: string
}) {
  return `Requester: ${input.requesterEmail}\n\n${input.body}`
}

export function createLinearGateway(
  config: LinearGatewayConfig
): LinearGateway {
  const getConnection = createLinearConnectionProvider(config)
  return new LinearSdkGateway(
    async () => (await getConnection()).client,
    async () => (await getConnection()).accessToken,
    config
  )
}

function createLinearConnectionProvider(
  config: LinearGatewayConfig
): () => Promise<LinearConnection> {
  let current: LinearConnection | null = null
  let pending: Promise<LinearConnection> | null = null

  return async () => {
    if (
      current &&
      Date.now() < current.expiresAt - LINEAR_TOKEN_REFRESH_BUFFER_MS
    ) {
      return current
    }

    pending ??= requestLinearClient(config)
      .then((next) => {
        current = next
        return next
      })
      .finally(() => {
        pending = null
      })

    return pending
  }
}

async function requestLinearClient(config: LinearGatewayConfig) {
  const response = await fetch(LINEAR_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: LINEAR_OAUTH_SCOPE,
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }),
  })
  if (!response.ok) {
    throw new Error(
      `Linear OAuth token request failed with status ${response.status}`
    )
  }

  const payload = (await response.json()) as {
    access_token?: unknown
    expires_in?: unknown
  }
  if (
    typeof payload.access_token !== "string" ||
    !payload.access_token ||
    typeof payload.expires_in !== "number" ||
    payload.expires_in <= 0
  ) {
    throw new Error("Linear OAuth token response was invalid")
  }

  return {
    client: new LinearClient({ accessToken: payload.access_token }),
    accessToken: payload.access_token,
    expiresAt: Date.now() + payload.expires_in * 1000,
  }
}

class LinearSdkGateway implements LinearGateway {
  constructor(
    private readonly getClient: LinearClientProvider,
    private readonly getAccessToken: LinearAccessTokenProvider,
    private readonly config: LinearGatewayConfig
  ) {}

  async getIssueAssignment(issueId: string): Promise<LinearIssueAssignment> {
    const client = await this.getClient()
    const { issue } = await client.client.request<
      { issue: LinearIssueAssignment },
      { issueId: string }
    >(
      `query LinearDeskIssueAssignment($issueId: String!) {
        issue(id: $issueId) {
          assignee { id name: displayName avatarUrl }
          project { id name color }
          team { id name }
        }
      }`,
      { issueId }
    )
    return issue
  }

  async listTeamAssignees(teamId: string): Promise<LinearAssigneeSnapshot[]> {
    const client = await this.getClient()
    const team = await client.team(teamId)
    const assignees: LinearAssigneeSnapshot[] = []
    let after: string | undefined
    do {
      const page = await team.members({ first: 100, after })
      assignees.push(
        ...page.nodes
          .filter((user) => user.active)
          .map((user) => ({
            id: user.id,
            name: user.displayName,
            avatarUrl: user.avatarUrl ?? null,
          }))
      )
      if (!page.pageInfo.hasNextPage) break
      if (!page.pageInfo.endCursor)
        throw new Error("Linear team members returned an invalid cursor")
      after = page.pageInfo.endCursor
    } while (after)
    return assignees.sort((left, right) => left.name.localeCompare(right.name))
  }

  async updateIssueAssignee(
    issueId: string,
    assigneeId: string | null
  ): Promise<void> {
    const client = await this.getClient()
    const payload = await client.updateIssue(issueId, { assigneeId })
    if (!payload.success) throw new Error("Linear assignment update failed")
  }

  async listTeams(): Promise<LinearTeamSnapshot[]> {
    const client = await this.getClient()
    const { teams } = await client.client.request<
      LinearTeamsResponse,
      Record<string, never>
    >(`
      query LinearDeskTeams {
        teams(first: 250, includeArchived: false) {
          nodes {
            id
            key
            displayName
            retiredAt
          }
        }
      }
    `)

    return teams.nodes
      .filter((team) => !team.retiredAt)
      .map((team) => ({
        id: team.id,
        key: team.key,
        name: team.displayName,
      }))
      .sort((left, right) => left.name.localeCompare(right.name))
  }

  async createHelpdeskIssue(
    input: CreateHelpdeskIssueInput
  ): Promise<LinearIssueSnapshot> {
    const [state, label] = await Promise.all([
      this.findInitialState(input.teamId),
      this.findIssueLabel(input.teamId),
    ])
    const client = await this.getClient()

    const payload = await client.createIssue(
      buildLinearIssueInput({
        ...input,
        stateId: state.id,
        labelId: label.id,
      })
    )

    if (!payload.success) throw new Error("Linear issue creation failed")

    const issue =
      (await payload.issue) ??
      (payload.issueId ? await client.issue(payload.issueId) : null)
    if (!issue)
      throw new Error("Linear issue was created but could not be fetched")

    const issueState = (await issue.state) ?? state

    return {
      id: issue.id,
      identifier: issue.identifier,
      url: issue.url,
      detailsCommentId: null,
      state: {
        id: issueState.id,
        name: issueState.name,
        type: issueState.type,
      },
    }
  }

  async listIssueComments(
    issueId: string
  ): Promise<LinearIssueCommentSnapshot[]> {
    const client = await this.getClient()
    const snapshots: LinearIssueCommentSnapshot[] = []
    let after: string | null = null
    do {
      const { comments }: LinearCommentsResponse = await client.client.request<
        LinearCommentsResponse,
        { issueId: string; after: string | null }
      >(
        `query LinearDeskComments($issueId: ID!, $after: String) {
          comments(first: 50, after: $after, filter: { issue: { id: { eq: $issueId } } }) {
            nodes {
              id
              body
              createdAt
              botActor { userDisplayName name }
              user { displayName name }
            }
            pageInfo { hasNextPage endCursor }
          }
        }`,
        { issueId, after }
      )
      snapshots.push(
        ...(await Promise.all(
          comments.nodes.map((comment) => this.toIssueCommentSnapshot(comment))
        ))
      )
      after = comments.pageInfo.hasNextPage ? comments.pageInfo.endCursor : null
    } while (after)

    return snapshots.sort(
      (left, right) => left.createdAt.getTime() - right.createdAt.getTime()
    )
  }

  async getIssueCommentBody(
    issueId: string,
    commentId: string
  ): Promise<string | null> {
    const client = await this.getClient()
    const { comments } = await client.client.request<
      { comments: { nodes: Array<{ body: string }> } },
      { issueId: string; commentId: string }
    >(
      `query LinearDeskCommentBody($issueId: ID!, $commentId: ID!) {
        comments(first: 1, filter: {
          id: { eq: $commentId }
          issue: { id: { eq: $issueId } }
        }) {
          nodes { body }
        }
      }`,
      { issueId, commentId }
    )
    return comments.nodes[0]?.body ?? null
  }

  async createIssueComment(
    input: CreateIssueCommentInput
  ): Promise<LinearIssueCommentSnapshot> {
    const client = await this.getClient()
    const payload = await client.createComment(input)
    if (!payload.success)
      throw new Error("Linear issue comment creation failed")

    const comment = await payload.comment
    if (comment) return this.toIssueCommentSnapshot(comment)

    if (!payload.commentId) {
      throw new Error("Linear issue comment was created but no id was returned")
    }

    return {
      id: payload.commentId,
      body: input.body,
      authorName: "Desk",
      createdAt: new Date(),
    }
  }

  async uploadAsset(input: UploadAssetInput): Promise<UploadAssetResult> {
    const client = await this.getClient()
    const payload = await client.fileUpload(
      input.contentType,
      input.filename,
      input.bytes.byteLength
    )
    const uploadFile = payload.uploadFile
    if (!uploadFile) {
      throw new Error("Linear file upload could not be prepared")
    }

    const headers = new Headers({ "content-type": input.contentType })
    for (const header of uploadFile.headers) {
      headers.set(header.key, header.value)
    }

    const response = await fetch(uploadFile.uploadUrl, {
      method: "PUT",
      headers,
      body: input.bytes as BodyInit,
    })
    if (!response.ok) {
      throw new Error(
        `Linear asset upload failed with status ${response.status}`
      )
    }

    return { assetUrl: uploadFile.assetUrl }
  }

  async downloadAsset(assetUrl: string): Promise<DownloadAssetResult> {
    const url = new URL(assetUrl)
    if (url.protocol !== "https:" || url.hostname !== "uploads.linear.app") {
      throw new Error("Linear asset URL is not allowed")
    }

    const response = await fetch(url, {
      headers: { authorization: `Bearer ${await this.getAccessToken()}` },
    })
    if (!response.ok) {
      throw new Error(
        `Linear asset download failed with status ${response.status}`
      )
    }

    const contentType = response.headers.get("content-type") ?? ""
    if (!contentType.startsWith("image/")) {
      throw new Error("Linear asset is not an image")
    }
    const contentLength = Number(response.headers.get("content-length"))
    if (contentLength > MAX_LINEAR_IMAGE_BYTES) {
      throw new Error("Linear asset is larger than the 20 MB limit")
    }

    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > MAX_LINEAR_IMAGE_BYTES) {
      throw new Error("Linear asset is larger than the 20 MB limit")
    }

    return {
      bytes,
      contentType,
    }
  }

  async updateIssueFields(input: {
    issueId: string
    title: string
    description: string
    priority: number
  }): Promise<void> {
    const client = await this.getClient()
    const payload = await client.updateIssue(input.issueId, {
      title: input.title,
      description: input.description,
      priority: input.priority,
    })
    if (!payload.success) throw new Error("Linear issue update failed")
  }

  async updateIssuePriority(input: {
    issueId: string
    priority: number
  }): Promise<void> {
    const client = await this.getClient()
    const payload = await client.updateIssue(input.issueId, {
      priority: input.priority,
    })
    if (!payload.success) throw new Error("Linear issue update failed")
  }

  async closeIssue(input: CloseIssueInput): Promise<LinearIssueStateSnapshot> {
    const state = await this.findWorkflowStateByType(
      input.resolution === "resolved" ? "completed" : "canceled",
      input.teamId
    )
    const client = await this.getClient()

    const payload = await client.updateIssue(input.issueId, {
      stateId: state.id,
    })
    if (!payload.success) throw new Error("Linear issue update failed")

    const issue = await payload.issue
    const issueState = issue ? ((await issue.state) ?? state) : state

    return {
      id: issueState.id,
      name: issueState.name,
      type: issueState.type,
    }
  }

  async listIssueStates(issueIds: string[]): Promise<IssueStateSnapshot[]> {
    if (issueIds.length === 0) return []

    const client = await this.getClient()
    const snapshots: IssueStateSnapshot[] = []
    for (let offset = 0; offset < issueIds.length; offset += 250) {
      const { issues } = await client.client.request<
        { issues: { nodes: IssueStateSnapshot[] } },
        { issueIds: string[] }
      >(
        `query LinearDeskIssueStates($issueIds: [ID!]!) {
          issues(first: 250, filter: { id: { in: $issueIds } }) {
            nodes {
              id
              identifier
              url
              state { id name type }
            }
          }
        }`,
        { issueIds: issueIds.slice(offset, offset + 250) }
      )
      snapshots.push(...issues.nodes)
    }

    return snapshots
  }

  private async toIssueCommentSnapshot(
    comment: LinearCommentData
  ): Promise<LinearIssueCommentSnapshot> {
    let authorName =
      comment.botActor?.userDisplayName || comment.botActor?.name || null

    if (!authorName) {
      try {
        const user = await comment.user
        authorName = user?.displayName || user?.name || null
      } catch {
        authorName = null
      }
    }

    return {
      id: comment.id,
      body: comment.body,
      authorName: authorName || "Linear",
      createdAt: new Date(comment.createdAt),
    }
  }

  private async findInitialState(teamId: string) {
    const client = await this.getClient()
    const states = await client.workflowStates({
      first: 100,
      includeArchived: false,
    })
    const state = selectWorkflowStateByName(
      states.nodes,
      this.config.initialStateName,
      teamId
    )

    if (!state) {
      throw new Error(
        `Linear workflow state "${this.config.initialStateName}" was not found for team ${teamId}`
      )
    }

    return state
  }

  private async findWorkflowStateByType(type: string, teamId: string) {
    const client = await this.getClient()
    const states = await client.workflowStates({
      first: 100,
      includeArchived: false,
    })
    const state = selectWorkflowStateByType(states.nodes, type, teamId)

    if (!state) {
      throw new Error(
        `Linear workflow state of type "${type}" was not found for team ${teamId}`
      )
    }

    return state
  }

  private async findIssueLabel(teamId: string) {
    const client = await this.getClient()
    const labels = await client.issueLabels({
      first: 100,
      includeArchived: false,
    })

    return requireIssueLabelByName(labels.nodes, this.config.labelName, teamId)
  }
}
