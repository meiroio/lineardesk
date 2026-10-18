import { Elysia } from "elysia"

import { markdownImages } from "../../lib/markdown-images"
import {
  buildRequesterReplyCommentBody,
  getDetailsCommentMarker,
} from "../linear"
import {
  parseCreateCommentInput,
  parseCreateRequestInput,
  parseUpdateRequestInput,
  parseUpdateSeverityInput,
  RequestValidationError,
} from "../request-validation"
import type { CloseIssueResolution } from "../types"
import {
  CloseRequestBodyModel,
  CreateCommentBodyModel,
  CreateRequestBodyModel,
  ErrorResponseModel,
  LinearTeamsResponseModel,
  PortalRequestListResponseModel,
  PortalRequestCommentResponseModel,
  PortalRequestResponseModel,
  RequestParamsModel,
  RequestListQueryModel,
  UpdateRequestBodyModel,
  UpdateRequestSeverityBodyModel,
  ValidationErrorResponseModel,
} from "./contracts"
import type { ApiDependenciesPlugin } from "./dependencies"
import {
  requireAuthorizedSession,
  serializeLinearComment,
  serializeRequest,
} from "./http"

function parseResolution(body: unknown): CloseIssueResolution | null {
  if (!body || typeof body !== "object" || !("resolution" in body)) return null
  const value = body.resolution
  return value === "resolved" || value === "canceled" ? value : null
}

export function createRequestsApi(apiDependencies: ApiDependenciesPlugin) {
  return new Elysia({ name: "api.requests" })
    .use(apiDependencies)
    .get(
      "/teams",
      async ({ request, resolveApiDependencies, status }) => {
        const deps = resolveApiDependencies()
        const authorization = await requireAuthorizedSession(
          deps,
          request.headers
        )
        if (!authorization.ok) {
          return status(authorization.status, authorization.body)
        }

        return {
          teams: await deps.linear.listTeams(),
          defaultTeamId: deps.config.linear.teamId,
        }
      },
      {
        response: {
          200: LinearTeamsResponseModel,
          401: ErrorResponseModel,
          403: ErrorResponseModel,
          409: ErrorResponseModel,
        },
      }
    )
    .get(
      "/requests",
      async ({ query, request, resolveApiDependencies, status }) => {
        const deps = resolveApiDependencies()
        const authorization = await requireAuthorizedSession(
          deps,
          request.headers
        )
        if (!authorization.ok) {
          return status(authorization.status, authorization.body)
        }
        const { session } = authorization

        const filters = {
          page: query.page ?? 0,
          pageSize: query.pageSize ?? 20,
          status: query.status ?? ("all" as const),
          severity: query.severity?.split(",").map(Number) ?? [],
          ...(query.teamId ? { teamId: query.teamId } : {}),
        }
        const { requests, total } = await deps.repo.listRequestsForOrganization(
          session.organizationId,
          filters
        )
        return {
          requests: requests.map((record) => ({
            ...record,
            createdAt: record.createdAt.toISOString(),
            updatedAt: record.updatedAt.toISOString(),
          })),
          total,
          page: filters.page,
          pageSize: filters.pageSize,
        }
      },
      {
        query: RequestListQueryModel,
        response: {
          200: PortalRequestListResponseModel,
          401: ErrorResponseModel,
          403: ErrorResponseModel,
          409: ErrorResponseModel,
        },
      }
    )
    .post(
      "/requests",
      async ({ body, request, resolveApiDependencies, status }) => {
        const deps = resolveApiDependencies()
        const authorization = await requireAuthorizedSession(
          deps,
          request.headers
        )
        if (!authorization.ok) {
          return status(authorization.status, authorization.body)
        }
        const { session } = authorization

        let input: ReturnType<typeof parseCreateRequestInput>
        try {
          input = parseCreateRequestInput(body)
        } catch (error) {
          if (error instanceof RequestValidationError) {
            return status(400, {
              error: "validation_error",
              issues: error.issues,
            })
          }

          throw error
        }

        const teamId = body.teamId?.trim() || deps.config.linear.teamId
        const teams = await deps.linear.listTeams()
        if (!teams.some((team) => team.id === teamId)) {
          return status(400, {
            error: "validation_error",
            issues: ["Team is not available"],
          })
        }

        const { severity, ...issueInput } = input
        const linearIssue = await deps.linear.createHelpdeskIssue({
          ...issueInput,
          requesterEmail: session.user.email,
          teamId,
          priority: severity,
        })
        const record = await deps.repo.createRequest({
          requesterUserId: session.user.id,
          organizationId: session.organizationId,
          requesterEmail: session.user.email,
          ...issueInput,
          severity,
          linearIssue,
          linearTeamId: teamId,
          source: "web",
        })

        return status(201, { request: serializeRequest(record) })
      },
      {
        body: CreateRequestBodyModel,
        response: {
          201: PortalRequestResponseModel,
          400: ValidationErrorResponseModel,
          401: ErrorResponseModel,
          403: ErrorResponseModel,
          409: ErrorResponseModel,
        },
      }
    )
    .get(
      "/requests/:id",
      async ({ params, request, resolveApiDependencies, status }) => {
        const deps = resolveApiDependencies()
        const authorization = await requireAuthorizedSession(
          deps,
          request.headers
        )
        if (!authorization.ok) {
          return status(authorization.status, authorization.body)
        }
        const { session } = authorization

        const record = await deps.repo.getRequestForOrganization(
          params.id,
          session.organizationId
        )
        if (!record) return status(404, { error: "not_found" })

        const allComments = await deps.linear.listIssueComments(
          record.linearIssueId
        )
        const detailsMarker = getDetailsCommentMarker(record.linearIssueId)
        const comments = allComments.filter(
          (comment) =>
            comment.id !== record.linearDetailsCommentId &&
            !comment.body.includes(detailsMarker)
        )

        return { request: serializeRequest(record, comments) }
      },
      {
        params: RequestParamsModel,
        response: {
          200: PortalRequestResponseModel,
          401: ErrorResponseModel,
          403: ErrorResponseModel,
          404: ErrorResponseModel,
          409: ErrorResponseModel,
        },
      }
    )
    .get(
      "/requests/:id/assets",
      async ({ params, query, request, resolveApiDependencies, status }) => {
        const deps = resolveApiDependencies()
        const authorization = await requireAuthorizedSession(
          deps,
          request.headers
        )
        if (!authorization.ok) {
          return status(authorization.status, authorization.body)
        }

        const record = await deps.repo.getRequestForOrganization(
          params.id,
          authorization.session.organizationId
        )
        if (!record) return status(404, { error: "not_found" })

        const assetUrl = typeof query.url === "string" ? query.url : ""
        const descriptionHasAsset = markdownImages(record.description).some(
          (image) => image.url === assetUrl
        )
        const commentBody =
          !descriptionHasAsset && typeof query.commentId === "string"
            ? await deps.linear.getIssueCommentBody(
                record.linearIssueId,
                query.commentId
              )
            : null
        const commentHasAsset =
          commentBody !== null &&
          markdownImages(commentBody).some((image) => image.url === assetUrl)
        if (!descriptionHasAsset && !commentHasAsset) {
          return status(404, { error: "not_found" })
        }

        try {
          const asset = await deps.linear.downloadAsset(assetUrl)
          return new Response(asset.bytes as BodyInit, {
            headers: {
              "cache-control": "private, max-age=3600",
              "content-type": asset.contentType,
              "x-content-type-options": "nosniff",
            },
          })
        } catch {
          return status(404, { error: "not_found" })
        }
      }
    )
    .post(
      "/requests/:id/comments",
      async ({ params, body, request, resolveApiDependencies, status }) => {
        const deps = resolveApiDependencies()
        const authorization = await requireAuthorizedSession(
          deps,
          request.headers
        )
        if (!authorization.ok) {
          return status(authorization.status, authorization.body)
        }
        const { session } = authorization

        let input: ReturnType<typeof parseCreateCommentInput>
        try {
          input = parseCreateCommentInput(body)
        } catch (error) {
          if (error instanceof RequestValidationError) {
            return status(400, {
              error: "validation_error",
              issues: error.issues,
            })
          }

          throw error
        }

        const record = await deps.repo.getRequestForOrganization(
          params.id,
          session.organizationId
        )
        if (!record) return status(404, { error: "not_found" })

        const comment = await deps.linear.createIssueComment({
          issueId: record.linearIssueId,
          body: buildRequesterReplyCommentBody({
            requesterEmail: session.user.email,
            body: input.body,
          }),
        })

        return status(201, { comment: serializeLinearComment(comment) })
      },
      {
        body: CreateCommentBodyModel,
        params: RequestParamsModel,
        response: {
          201: PortalRequestCommentResponseModel,
          400: ValidationErrorResponseModel,
          401: ErrorResponseModel,
          403: ErrorResponseModel,
          404: ErrorResponseModel,
          409: ErrorResponseModel,
        },
      }
    )
    .post(
      "/requests/:id/close",
      async ({ params, body, request, resolveApiDependencies, status }) => {
        const deps = resolveApiDependencies()
        const authorization = await requireAuthorizedSession(
          deps,
          request.headers
        )
        if (!authorization.ok) {
          return status(authorization.status, authorization.body)
        }
        const { session } = authorization

        const resolution = parseResolution(body)
        if (!resolution) {
          return status(400, {
            error: "validation_error",
            issues: ["resolution must be 'resolved' or 'canceled'"],
          })
        }

        const record = await deps.repo.getRequestForOrganization(
          params.id,
          session.organizationId
        )
        if (!record) return status(404, { error: "not_found" })

        const state = await deps.linear.closeIssue({
          issueId: record.linearIssueId,
          teamId: record.linearTeamId,
          resolution,
        })
        await deps.repo.updateRequestFromLinear({
          linearIssueId: record.linearIssueId,
          linearIdentifier: record.linearIdentifier,
          linearUrl: record.linearUrl,
          linearStateId: state.id,
          linearStateName: state.name,
          linearStateType: state.type,
        })

        const updated = await deps.repo.getRequestForOrganization(
          params.id,
          session.organizationId
        )
        return { request: serializeRequest(updated ?? record) }
      },
      {
        body: CloseRequestBodyModel,
        params: RequestParamsModel,
        response: {
          200: PortalRequestResponseModel,
          400: ValidationErrorResponseModel,
          401: ErrorResponseModel,
          403: ErrorResponseModel,
          404: ErrorResponseModel,
          409: ErrorResponseModel,
        },
      }
    )
    .post(
      "/requests/:id/severity",
      async ({ params, body, request, resolveApiDependencies, status }) => {
        const deps = resolveApiDependencies()
        const authorization = await requireAuthorizedSession(
          deps,
          request.headers
        )
        if (!authorization.ok) {
          return status(authorization.status, authorization.body)
        }
        const { session } = authorization

        let input: ReturnType<typeof parseUpdateSeverityInput>
        try {
          input = parseUpdateSeverityInput(body)
        } catch (error) {
          if (error instanceof RequestValidationError) {
            return status(400, {
              error: "validation_error",
              issues: error.issues,
              fields: error.fields,
            })
          }
          throw error
        }

        const record = await deps.repo.getRequestForOrganization(
          params.id,
          session.organizationId
        )
        if (!record) return status(404, { error: "not_found" })

        await deps.linear.updateIssuePriority({
          issueId: record.linearIssueId,
          priority: input.severity,
        })
        const updated = await deps.repo.updateRequestSeverity({
          id: record.id,
          severity: input.severity,
        })
        return { request: serializeRequest(updated ?? record) }
      },
      {
        body: UpdateRequestSeverityBodyModel,
        params: RequestParamsModel,
        response: {
          200: PortalRequestResponseModel,
          400: ValidationErrorResponseModel,
          401: ErrorResponseModel,
          403: ErrorResponseModel,
          404: ErrorResponseModel,
          409: ErrorResponseModel,
        },
      }
    )
    .post(
      "/requests/:id/update",
      async ({ params, body, request, resolveApiDependencies, status }) => {
        const deps = resolveApiDependencies()
        const authorization = await requireAuthorizedSession(
          deps,
          request.headers
        )
        if (!authorization.ok) {
          return status(authorization.status, authorization.body)
        }
        const { session } = authorization

        let input: ReturnType<typeof parseUpdateRequestInput>
        try {
          input = parseUpdateRequestInput(body)
        } catch (error) {
          if (error instanceof RequestValidationError) {
            return status(400, {
              error: "validation_error",
              issues: error.issues,
              fields: error.fields,
            })
          }
          throw error
        }

        const record = await deps.repo.getRequestForOrganization(
          params.id,
          session.organizationId
        )
        if (!record) return status(404, { error: "not_found" })
        if (
          ["completed", "canceled", "duplicate"].includes(
            record.linearStateType
          )
        ) {
          return status(409, { error: "ticket_closed" })
        }

        await deps.linear.updateIssueFields({
          issueId: record.linearIssueId,
          title: input.title,
          description: input.description,
          priority: input.severity,
        })
        const updated = await deps.repo.updateRequestFields({
          id: record.id,
          title: input.title,
          description: input.description,
          severity: input.severity,
        })
        return { request: serializeRequest(updated ?? record) }
      },
      {
        body: UpdateRequestBodyModel,
        params: RequestParamsModel,
        response: {
          200: PortalRequestResponseModel,
          400: ValidationErrorResponseModel,
          401: ErrorResponseModel,
          403: ErrorResponseModel,
          404: ErrorResponseModel,
          409: ErrorResponseModel,
        },
      }
    )
}
