import { resolvePortalOrganization } from "../org-access"
import type {
  AuthSession,
  LinearIssueCommentSnapshot,
  RequestRecord,
} from "../types"
import type { ResolvedApiDependencies } from "./dependencies"

export type AuthorizedPortalSession = AuthSession & { organizationId: string }

export async function requireAuthorizedSession(
  deps: ResolvedApiDependencies,
  headers: Headers
): Promise<AuthorizedPortalSession | Response> {
  const session = await deps.auth.getSession(headers)
  if (!session) return json({ error: "unauthorized" }, 401)

  const resolution = await resolvePortalOrganization(session, deps.orgAccess)
  if (resolution.status === "multiple_organizations") {
    return json({ error: "multiple_organizations" }, 409)
  }
  if (resolution.status !== "ok") {
    return json({ error: "forbidden_org" }, 403)
  }

  return { ...session, organizationId: resolution.organizationId }
}

export function serializeRequest(
  record: RequestRecord,
  comments?: LinearIssueCommentSnapshot[]
) {
  return {
    ...record,
    linearDetailsCommentedAt:
      record.linearDetailsCommentedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    lastLinearSyncedAt: record.lastLinearSyncedAt.toISOString(),
    comments: comments?.map(serializeLinearComment),
  }
}

export function serializeLinearComment(comment: LinearIssueCommentSnapshot) {
  return {
    ...comment,
    createdAt: comment.createdAt.toISOString(),
  }
}

export function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json",
    },
  })
}
