import { t } from "elysia"

const NullableString = t.Union([t.String(), t.Null()])
const NullableNumber = t.Union([t.Number(), t.Null()])

export const ErrorResponseModel = t.Object({
  error: t.String(),
})

export const EmptyResponseModel = t.Literal("")

export const ValidationErrorResponseModel = t.Object({
  error: t.Literal("validation_error"),
  issues: t.Array(t.String()),
  fields: t.Optional(t.Record(t.String(), t.String())),
})

export const HealthResponseModel = t.Object({
  ok: t.Boolean(),
})

export const PortalRequestCommentModel = t.Object({
  id: t.String(),
  body: t.String(),
  authorName: t.String(),
  createdAt: t.String(),
})

export const PortalRequestModel = t.Object({
  id: t.String(),
  requesterUserId: NullableString,
  organizationId: NullableString,
  requesterEmail: t.String(),
  title: t.String(),
  description: t.String(),
  linearIssueId: t.String(),
  linearIdentifier: t.String(),
  linearUrl: t.String(),
  linearTeamId: t.String(),
  linearStateId: t.String(),
  linearStateName: t.String(),
  linearStateType: t.String(),
  source: t.Union([t.Literal("web"), t.Literal("slack")]),
  severity: NullableNumber,
  linearDetailsCommentId: NullableString,
  linearDetailsCommentedAt: NullableString,
  createdAt: t.String(),
  updatedAt: t.String(),
  lastLinearSyncedAt: t.String(),
  slackChannelId: NullableString,
  slackMessageTs: NullableString,
  comments: t.Optional(t.Array(PortalRequestCommentModel)),
})

export const PortalRequestSummaryModel = t.Pick(PortalRequestModel, [
  "id",
  "title",
  "linearIdentifier",
  "linearStateName",
  "linearStateType",
  "severity",
  "createdAt",
  "updatedAt",
])

export const RequestListQueryModel = t.Object({
  page: t.Optional(
    t.Numeric({ minimum: 0, maximum: 1_000_000, multipleOf: 1 })
  ),
  pageSize: t.Optional(t.Numeric({ minimum: 1, maximum: 100, multipleOf: 1 })),
  status: t.Optional(
    t.Union([t.Literal("active"), t.Literal("done"), t.Literal("all")])
  ),
  severity: t.Optional(t.String({ pattern: "^[1-4](,[1-4]){0,3}$" })),
  teamId: t.Optional(t.String({ minLength: 1, maxLength: 128 })),
})

export const PortalRequestListResponseModel = t.Object({
  requests: t.Array(PortalRequestSummaryModel),
  total: t.Number(),
  page: t.Number(),
  pageSize: t.Number(),
})

export const PortalRequestResponseModel = t.Object({
  request: PortalRequestModel,
})

export const PortalRequestCommentResponseModel = t.Object({
  comment: PortalRequestCommentModel,
})

export const LinearTeamModel = t.Object({
  id: t.String(),
  key: t.String(),
  name: t.String(),
})

export const LinearTeamsResponseModel = t.Object({
  teams: t.Array(LinearTeamModel),
  defaultTeamId: t.String(),
})

export const LinearProjectModel = t.Object({
  id: t.String(),
  name: t.String(),
  color: NullableString,
})
export const LinearAssigneeModel = t.Object({
  id: t.String(),
  name: t.String(),
  avatarUrl: NullableString,
})
export const RequestAssignmentModel = t.Object({
  assignee: t.Union([LinearAssigneeModel, t.Null()]),
  project: t.Union([LinearProjectModel, t.Null()]),
  team: t.Object({ id: t.String(), name: t.String() }),
  assignees: t.Array(LinearAssigneeModel),
})
export const UpdateAssignmentBodyModel = t.Object({
  assigneeId: t.Union([t.String({ minLength: 1, maxLength: 128 }), t.Null()]),
})
export type RequestAssignment = typeof RequestAssignmentModel.static

export const CreateRequestBodyModel = t.Object({
  title: t.String(),
  severity: t.String(),
  teamId: t.Optional(t.String()),
  expectedBehaviour: t.String(),
  currentBehaviour: t.String(),
  stepsToReproduce: t.String(),
  attachments: t.Optional(t.String()),
})

export const UpdateRequestBodyModel = t.Object({
  title: t.String(),
  description: t.String(),
  severity: t.String(),
})

export const UpdateRequestSeverityBodyModel = t.Object({
  severity: t.Number(),
})

export const CreateCommentBodyModel = t.Object({
  body: t.String(),
})

export const CloseRequestBodyModel = t.Object({
  resolution: t.String(),
})

export const RequestParamsModel = t.Object({
  id: t.String(),
})

export const UploadImageResponseModel = t.Object({
  assetUrl: t.String(),
  filename: t.String(),
})

export const LinearWebhookResponseModel = t.Object({
  ok: t.Boolean(),
  duplicate: t.Optional(t.Boolean()),
  ignored: t.Optional(t.Boolean()),
})

export const CronReconcileResponseModel = t.Object({
  ok: t.Boolean(),
  checked: t.Number(),
  updated: t.Number(),
})

export const SlackInteractivityErrorResponseModel = t.Object({
  response_action: t.Literal("errors"),
  errors: t.Record(t.String(), t.String()),
})

export const SlackUrlVerificationResponseModel = t.Object({
  challenge: t.String(),
})

export const SlackInteractivityResponseModel = t.Union([
  EmptyResponseModel,
  SlackInteractivityErrorResponseModel,
])

export const SlackEventsResponseModel = t.Union([
  EmptyResponseModel,
  SlackUrlVerificationResponseModel,
])

export type PortalRequest = typeof PortalRequestModel.static
export type PortalRequestSummary = typeof PortalRequestSummaryModel.static
export type PortalRequestListResponse =
  typeof PortalRequestListResponseModel.static
export type { RequestListQuery } from "../types"
export type PortalRequestComment = typeof PortalRequestCommentModel.static
export type LinearTeam = typeof LinearTeamModel.static
export type LinearTeamsResponse = typeof LinearTeamsResponseModel.static
export type UploadImageResponse = typeof UploadImageResponseModel.static
