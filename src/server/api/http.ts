import { resolvePortalOrganization } from "../org-access"
import type {
  AuthSession,
  LinearIssueCommentSnapshot,
  RequestRecord,
} from "../types"
import type { ResolvedApiDependencies } from "./dependencies"

export type AuthorizedPortalSession = AuthSession & { organizationId: string }

export type PortalAuthorizationResult =
  | { ok: true; session: AuthorizedPortalSession }
  | {
      ok: false
      status: 401 | 403 | 409
      body: { error: string }
    }

export async function requireAuthorizedSession(
  deps: ResolvedApiDependencies,
  headers: Headers
): Promise<PortalAuthorizationResult> {
  const session = await deps.auth.getSession(headers)
  if (!session) {
    return { ok: false, status: 401, body: { error: "unauthorized" } }
  }

  const resolution = await resolvePortalOrganization(session, deps.orgAccess)
  if (resolution.status === "multiple_organizations") {
    return {
      ok: false,
      status: 409,
      body: { error: "multiple_organizations" },
    }
  }
  if (resolution.status !== "ok") {
    return { ok: false, status: 403, body: { error: "forbidden_org" } }
  }

  return {
    ok: true,
    session: { ...session, organizationId: resolution.organizationId },
  }
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
