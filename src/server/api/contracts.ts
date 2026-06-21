import { t } from "elysia"

const NullableString = t.Union([t.String(), t.Null()])
const NullableNumber = t.Union([t.Number(), t.Null()])

export const ErrorResponseModel = t.Object({
  error: t.String(),
})

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

export const PortalRequestListResponseModel = t.Object({
  requests: t.Array(PortalRequestModel),
})

export const PortalRequestResponseModel = t.Object({
  request: PortalRequestModel,
})

export const PortalRequestCommentResponseModel = t.Object({
  comment: PortalRequestCommentModel,
})

export const CreateRequestBodyModel = t.Object({
  title: t.String(),
  severity: t.String(),
  expectedBehaviour: t.String(),
  currentBehaviour: t.String(),
  stepsToReproduce: t.String(),
})

export const UpdateRequestBodyModel = t.Object({
  title: t.String(),
  description: t.String(),
  severity: t.String(),
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

export type PortalRequest = typeof PortalRequestModel.static
export type PortalRequestComment = typeof PortalRequestCommentModel.static
export type PortalRequestListResponse =
  typeof PortalRequestListResponseModel.static
export type PortalRequestResponse = typeof PortalRequestResponseModel.static
export type PortalRequestCommentResponse =
  typeof PortalRequestCommentResponseModel.static
export type UploadImageResponse = typeof UploadImageResponseModel.static
