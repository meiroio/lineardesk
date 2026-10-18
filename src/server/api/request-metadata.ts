import { Elysia } from "elysia"

import type { ApiDependenciesPlugin } from "./dependencies"
import {
  ErrorResponseModel,
  RequestAssignmentModel,
  RequestParamsModel,
  UpdateAssignmentBodyModel,
} from "./contracts"
import { requireAuthorizedSession } from "./http"

const authErrors = {
  401: ErrorResponseModel,
  403: ErrorResponseModel,
  409: ErrorResponseModel,
  502: ErrorResponseModel,
}

export function createRequestMetadataApi(
  apiDependencies: ApiDependenciesPlugin
) {
  return new Elysia({ name: "api.request-metadata" })
    .use(apiDependencies)
    .get(
      "/requests/:id/assignment",
      async ({ params, request, resolveApiDependencies, status }) => {
        const deps = resolveApiDependencies()
        const authorization = await requireAuthorizedSession(
          deps,
          request.headers
        )
        if (!authorization.ok)
          return status(authorization.status, authorization.body)
        const record = await deps.repo.getRequestForOrganization(
          params.id,
          authorization.session.organizationId
        )
        if (!record) return status(404, { error: "not_found" })
        try {
          const assignment = await deps.linear.getIssueAssignment(
            record.linearIssueId
          )
          const assignees = await deps.linear.listTeamAssignees(
            assignment.team.id
          )
          return { ...assignment, assignees }
        } catch {
          return status(502, { error: "assignment_unavailable" })
        }
      },
      {
        params: RequestParamsModel,
        response: {
          200: RequestAssignmentModel,
          404: ErrorResponseModel,
          ...authErrors,
        },
      }
    )
    .post(
      "/requests/:id/assignment",
      async ({ params, body, request, resolveApiDependencies, status }) => {
        const deps = resolveApiDependencies()
        const authorization = await requireAuthorizedSession(
          deps,
          request.headers
        )
        if (!authorization.ok)
          return status(authorization.status, authorization.body)
        const record = await deps.repo.getRequestForOrganization(
          params.id,
          authorization.session.organizationId
        )
        if (!record) return status(404, { error: "not_found" })
        try {
          const assignment = await deps.linear.getIssueAssignment(
            record.linearIssueId
          )
          const assignees = await deps.linear.listTeamAssignees(
            assignment.team.id
          )
          if (
            body.assigneeId !== null &&
            !assignees.some((user) => user.id === body.assigneeId)
          )
            return status(400, { error: "assignee_not_in_team" })
          await deps.linear.updateIssueAssignee(
            record.linearIssueId,
            body.assigneeId
          )
          return {
            ...(await deps.linear.getIssueAssignment(record.linearIssueId)),
            assignees,
          }
        } catch {
          return status(502, { error: "assignment_update_failed" })
        }
      },
      {
        params: RequestParamsModel,
        body: UpdateAssignmentBodyModel,
        response: {
          200: RequestAssignmentModel,
          400: ErrorResponseModel,
          404: ErrorResponseModel,
          ...authErrors,
        },
      }
    )
}
