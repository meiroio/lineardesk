import { LinearClient } from "@linear/sdk"

import type {
  AppConfig,
  CloseIssueInput,
  CreateIssueCommentInput,
  CreateHelpdeskIssueInput,
  IssueStateSnapshot,
  LinearGateway,
  LinearIssueCommentSnapshot,
  LinearIssueSnapshot,
  LinearIssueStateSnapshot,
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
type LinearIssueCreateInput = {
  title: string
  description: string
  teamId: string
  stateId: string
  labelIds?: string[]
  priority?: number
}

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
  return new LinearSdkGateway(
    new LinearClient({ apiKey: config.apiKey }),
    config
  )
}

class LinearSdkGateway implements LinearGateway {
  constructor(
    private readonly client: LinearClient,
    private readonly config: LinearGatewayConfig
  ) {}

  async createHelpdeskIssue(
    input: CreateHelpdeskIssueInput
  ): Promise<LinearIssueSnapshot> {
    const [state, label] = await Promise.all([
      this.findInitialState(),
      this.findIssueLabel(),
    ])

    const payload = await this.client.createIssue(
      buildLinearIssueInput({
        ...input,
        teamId: this.config.teamId,
        stateId: state.id,
        labelId: label.id,
      })
    )

    if (!payload.success) throw new Error("Linear issue creation failed")

    const issue =
      (await payload.issue) ??
      (payload.issueId ? await this.client.issue(payload.issueId) : null)
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
    const comments = await this.client.comments({
      filter: { issue: { id: { eq: issueId } } },
      first: 50,
    })
    const snapshots = await Promise.all(
      comments.nodes.map((comment) => this.toIssueCommentSnapshot(comment))
    )

    return snapshots.sort(
      (left, right) => left.createdAt.getTime() - right.createdAt.getTime()
    )
  }

  async createIssueComment(
    input: CreateIssueCommentInput
  ): Promise<LinearIssueCommentSnapshot> {
    const payload = await this.client.createComment(input)
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
    const payload = await this.client.fileUpload(
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

  async closeIssue(input: CloseIssueInput): Promise<LinearIssueStateSnapshot> {
    const state = await this.findWorkflowStateByType(
      input.resolution === "resolved" ? "completed" : "canceled"
    )

    const payload = await this.client.updateIssue(input.issueId, {
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

    const issues = await this.client.issues({
      filter: { id: { in: issueIds } },
      first: 250,
    })

    const snapshots = await Promise.all(
      issues.nodes.map(async (issue) => {
        const state = await issue.state
        if (!state) return null

        return {
          id: issue.id,
          identifier: issue.identifier,
          url: issue.url,
          state: { id: state.id, name: state.name, type: state.type },
        }
      })
    )

    return snapshots.filter(
      (snapshot): snapshot is IssueStateSnapshot => snapshot !== null
    )
  }

  private async toIssueCommentSnapshot(comment: {
    id: string
    body: string
    createdAt: Date
    botActor?: { userDisplayName?: string | null; name?: string | null } | null
    user?: PromiseLike<{
      displayName?: string | null
      name?: string | null
    } | null>
  }): Promise<LinearIssueCommentSnapshot> {
    // Prefer the inline botActor (no extra request); only resolve the user
    // relation — an additional Linear round-trip per comment — when needed.
    let authorName =
      comment.botActor?.userDisplayName || comment.botActor?.name || null

    if (!authorName && comment.user) {
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
      createdAt: comment.createdAt,
    }
  }

  private async findInitialState() {
    const states = await this.client.workflowStates({
      first: 100,
      includeArchived: false,
    })
    const state = selectWorkflowStateByName(
      states.nodes,
      this.config.initialStateName,
      this.config.teamId
    )

    if (!state) {
      throw new Error(
        `Linear workflow state "${this.config.initialStateName}" was not found for team ${this.config.teamId}`
      )
    }

    return state
  }

  private async findWorkflowStateByType(type: string) {
    const states = await this.client.workflowStates({
      first: 100,
      includeArchived: false,
    })
    const state = selectWorkflowStateByType(
      states.nodes,
      type,
      this.config.teamId
    )

    if (!state) {
      throw new Error(
        `Linear workflow state of type "${type}" was not found for team ${this.config.teamId}`
      )
    }

    return state
  }

  private async findIssueLabel() {
    const labels = await this.client.issueLabels({
      first: 100,
      includeArchived: false,
    })

    return requireIssueLabelByName(
      labels.nodes,
      this.config.labelName,
      this.config.teamId
    )
  }
}
