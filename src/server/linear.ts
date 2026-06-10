import { LinearClient } from "@linear/sdk"

import type {
  AppConfig,
  CreateIssueCommentInput,
  CreateHelpdeskIssueInput,
  HelpdeskIssueDetailsCommentInput,
  LinearGateway,
  LinearCommentSnapshot,
  LinearIssueCommentSnapshot,
  LinearIssueSnapshot,
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

type IssueDetailsCommentCandidate = {
  id: string
  body: string
}

type LinearGatewayConfig = AppConfig["linear"]
type LinearIssueCreateInput = {
  title: string
  description: string
  teamId: string
  stateId: string
  labelIds?: string[]
}
type LinearCommentCreateInput = {
  issueId: string
  body: string
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

export function selectDetailsCommentId<T extends IssueDetailsCommentCandidate>(
  comments: readonly T[],
  issueId: string
) {
  return (
    comments.find((comment) =>
      comment.body.includes(getDetailsCommentMarker(issueId))
    )?.id ?? null
  )
}

export function buildLinearIssueInput(input: {
  title: string
  description: string
  requesterEmail: string
  teamId: string
  stateId: string
  labelId: string | null
}): LinearIssueCreateInput {
  const issueInput: LinearIssueCreateInput = {
    title: input.title,
    description: `Requester: ${input.requesterEmail}\n\n${input.description}`,
    teamId: input.teamId,
    stateId: input.stateId,
  }

  if (input.labelId) issueInput.labelIds = [input.labelId]

  return issueInput
}

export function buildLinearIssueCommentInput(input: {
  issueId: string
  description: string
  requesterEmail: string
}): LinearCommentCreateInput {
  return {
    issueId: input.issueId,
    body: `Requester: ${input.requesterEmail}\n\n${input.description}\n\n---\n${getDetailsCommentMarker(input.issueId)}`,
  }
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

    let detailsCommentId: string | null = null
    try {
      detailsCommentId = (
        await this.createHelpdeskIssueDetailsComment({
          issueId: issue.id,
          description: input.description,
          requesterEmail: input.requesterEmail,
        })
      ).id
    } catch {
      detailsCommentId = null
    }

    const issueState = (await issue.state) ?? state

    return {
      id: issue.id,
      identifier: issue.identifier,
      url: issue.url,
      detailsCommentId,
      state: {
        id: issueState.id,
        name: issueState.name,
        type: issueState.type,
      },
    }
  }

  async createHelpdeskIssueDetailsComment(
    input: HelpdeskIssueDetailsCommentInput
  ): Promise<LinearCommentSnapshot> {
    const issue = await this.client.issue(input.issueId)

    const comments = await issue.comments({ first: 50 })
    const existingCommentId = selectDetailsCommentId(
      comments.nodes,
      input.issueId
    )
    if (existingCommentId) return { id: existingCommentId }

    const commentPayload = await this.client.createComment(
      buildLinearIssueCommentInput(input)
    )
    if (!commentPayload.success)
      throw new Error("Linear issue comment creation failed")

    const commentId =
      commentPayload.commentId ?? (await commentPayload.comment)?.id ?? null
    if (!commentId)
      throw new Error("Linear issue comment was created but no id was returned")

    return { id: commentId }
  }

  async listIssueComments(
    issueId: string
  ): Promise<LinearIssueCommentSnapshot[]> {
    const issue = await this.client.issue(issueId)
    const comments = await issue.comments({ first: 50 })
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
    let user: { displayName?: string | null; name?: string | null } | null =
      null
    if (comment.user) {
      try {
        user = await comment.user
      } catch {
        user = null
      }
    }

    const authorName =
      user?.displayName ||
      user?.name ||
      comment.botActor?.userDisplayName ||
      comment.botActor?.name ||
      "Linear"

    return {
      id: comment.id,
      body: comment.body,
      authorName,
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
