import { Elysia } from "elysia"

import {
  buildRequesterReplyCommentBody,
  getDetailsCommentMarker,
} from "../linear"
import {
  parseCreateCommentInput,
  parseCreateRequestInput,
  parseUpdateRequestInput,
  RequestValidationError,
} from "../request-validation"
import type { CloseIssueResolution } from "../types"
import {
  CloseRequestBodyModel,
  CreateCommentBodyModel,
  CreateRequestBodyModel,
  PortalRequestListResponseModel,
  PortalRequestResponseModel,
  RequestParamsModel,
  UpdateRequestBodyModel,
} from "./contracts"
import type { ApiDependencyResolver } from "./dependencies"
import {
  json,
  requireAuthorizedSession,
  serializeLinearComment,
  serializeRequest,
} from "./http"

function parseResolution(body: unknown): CloseIssueResolution | null {
  if (!body || typeof body !== "object" || !("resolution" in body)) return null
  const value = body.resolution
  return value === "resolved" || value === "canceled" ? value : null
}

export function createRequestsApi(getDependencies: ApiDependencyResolver) {
  return new Elysia({ name: "api.requests" })
    .get(
      "/requests",
      async ({ request }) => {
        const deps = getDependencies()
        const session = await requireAuthorizedSession(deps, request.headers)
        if (session instanceof Response) return session

        const requests = await deps.repo.listRequestsForOrganization(
          session.organizationId
        )
        return json({
          requests: requests.map((record) => serializeRequest(record)),
        })
      },
      {
        response: PortalRequestListResponseModel,
      }
    )
    .post(
      "/requests",
      async ({ body, request }) => {
        const deps = getDependencies()
        const session = await requireAuthorizedSession(deps, request.headers)
        if (session instanceof Response) return session

        let input: ReturnType<typeof parseCreateRequestInput>
        try {
          input = parseCreateRequestInput(body)
        } catch (error) {
          if (error instanceof RequestValidationError) {
            return json(
              { error: "validation_error", issues: error.issues },
              400
            )
          }

          throw error
        }

        const { severity, ...issueInput } = input
        const linearIssue = await deps.linear.createHelpdeskIssue({
          ...issueInput,
          requesterEmail: session.user.email,
          priority: severity,
        })
        const record = await deps.repo.createRequest({
          requesterUserId: session.user.id,
          organizationId: session.organizationId,
          requesterEmail: session.user.email,
          ...issueInput,
          severity,
          linearIssue,
          linearTeamId: deps.config.linear.teamId,
          source: "web",
        })

        return json({ request: serializeRequest(record) }, 201)
      },
      {
        body: CreateRequestBodyModel,
      }
    )
    .get(
      "/requests/:id",
      async ({ params, request }) => {
        const deps = getDependencies()
        const session = await requireAuthorizedSession(deps, request.headers)
        if (session instanceof Response) return session

        const record = await deps.repo.getRequestForOrganization(
          params.id,
          session.organizationId
        )
        if (!record) return json({ error: "not_found" }, 404)

        const allComments = await deps.linear.listIssueComments(
          record.linearIssueId
        )
        const detailsMarker = getDetailsCommentMarker(record.linearIssueId)
        const comments = allComments.filter(
          (comment) =>
            comment.id !== record.linearDetailsCommentId &&
            !comment.body.includes(detailsMarker)
        )

        return json({ request: serializeRequest(record, comments) })
      },
      {
        params: RequestParamsModel,
        response: PortalRequestResponseModel,
      }
    )
    .post(
      "/requests/:id/comments",
      async ({ params, body, request }) => {
        const deps = getDependencies()
        const session = await requireAuthorizedSession(deps, request.headers)
        if (session instanceof Response) return session

        let input: ReturnType<typeof parseCreateCommentInput>
        try {
          input = parseCreateCommentInput(body)
        } catch (error) {
          if (error instanceof RequestValidationError) {
            return json(
              { error: "validation_error", issues: error.issues },
              400
            )
          }

          throw error
        }

        const record = await deps.repo.getRequestForOrganization(
          params.id,
          session.organizationId
        )
        if (!record) return json({ error: "not_found" }, 404)

        const comment = await deps.linear.createIssueComment({
          issueId: record.linearIssueId,
          body: buildRequesterReplyCommentBody({
            requesterEmail: session.user.email,
            body: input.body,
          }),
        })

        return json({ comment: serializeLinearComment(comment) }, 201)
      },
      {
        body: CreateCommentBodyModel,
        params: RequestParamsModel,
      }
    )
    .post(
      "/requests/:id/close",
      async ({ params, body, request }) => {
        const deps = getDependencies()
        const session = await requireAuthorizedSession(deps, request.headers)
        if (session instanceof Response) return session

        const resolution = parseResolution(body)
        if (!resolution) {
          return json(
            {
              error: "validation_error",
              issues: ["resolution must be 'resolved' or 'canceled'"],
            },
            400
          )
        }

        const record = await deps.repo.getRequestForOrganization(
          params.id,
          session.organizationId
        )
        if (!record) return json({ error: "not_found" }, 404)

        const state = await deps.linear.closeIssue({
          issueId: record.linearIssueId,
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
      }
    )
    .post(
      "/requests/:id/update",
      async ({ params, body, request }) => {
        const deps = getDependencies()
        const session = await requireAuthorizedSession(deps, request.headers)
        if (session instanceof Response) return session

        let input: ReturnType<typeof parseUpdateRequestInput>
        try {
          input = parseUpdateRequestInput(body)
        } catch (error) {
          if (error instanceof RequestValidationError) {
            return json(
              {
                error: "validation_error",
                issues: error.issues,
                fields: error.fields,
              },
              400
            )
          }
          throw error
        }

        const record = await deps.repo.getRequestForOrganization(
          params.id,
          session.organizationId
        )
        if (!record) return json({ error: "not_found" }, 404)
        if (
          ["completed", "canceled", "duplicate"].includes(
            record.linearStateType
          )
        ) {
          return json({ error: "ticket_closed" }, 409)
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
      }
    )
}
