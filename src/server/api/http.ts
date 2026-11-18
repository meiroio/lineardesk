import { getSharedLinearCommentBody } from "../linear"
import { isStaffEmail, resolvePortalOrganization } from "../org-access"
import type {
  AuthSession,
  HelpdeskRepository,
  LinearIssueCommentSnapshot,
  PortalOrganizationResolution,
  RequestRecord,
} from "../types"
import type { ResolvedApiDependencies } from "./dependencies"

export type AuthorizedPortalSession = AuthSession & { organizationId: string }

type PortalAuthorizationFailure = {
  ok: false
  status: 401 | 403 | 409
  body: { error: string }
}

const unauthorized: PortalAuthorizationFailure = {
  ok: false,
  status: 401,
  body: { error: "unauthorized" },
}

type PortalReadScope =
  | { isStaff: true; organizationId: string | null }
  | { isStaff: false; organizationId: string }

export async function requireAuthorizedSession(
  deps: ResolvedApiDependencies,
  headers: Headers
): Promise<
  { ok: true; session: AuthorizedPortalSession } | PortalAuthorizationFailure
> {
  const session = await deps.auth.getSession(headers)
  if (!session) return unauthorized

  const resolution = await resolvePortalOrganization(session, deps.orgAccess)
  if (resolution.status !== "ok") return organizationDenial(resolution)

  return {
    ok: true,
    session: { ...session, organizationId: resolution.organizationId },
  }
}

export async function requirePortalReadScope(
  deps: ResolvedApiDependencies,
  headers: Headers
): Promise<({ ok: true } & PortalReadScope) | PortalAuthorizationFailure> {
  const session = await deps.auth.getSession(headers)
  if (!session) return unauthorized

  const resolution = await resolvePortalOrganization(session, deps.orgAccess)
  if (isStaffEmail(session.user.email)) {
    return {
      ok: true,
      isStaff: true,
      organizationId:
        resolution.status === "ok" ? resolution.organizationId : null,
    }
  }
  if (resolution.status !== "ok") return organizationDenial(resolution)

  return { ok: true, isStaff: false, organizationId: resolution.organizationId }
}

export async function requireRequestListScope(
  deps: ResolvedApiDependencies,
  headers: Headers,
  requestedOrganizationId?: string
): Promise<
  { ok: true; organizationId: string | null } | PortalAuthorizationFailure
> {
  const authorization = await requirePortalReadScope(deps, headers)
  if (!authorization.ok) return authorization
  if (
    requestedOrganizationId &&
    !authorization.isStaff &&
    requestedOrganizationId !== authorization.organizationId
  ) {
    return organizationDenial({ status: "forbidden" })
  }

  return {
    ok: true,
    organizationId: requestedOrganizationId ?? authorization.organizationId,
  }
}

function organizationDenial(
  resolution: Exclude<PortalOrganizationResolution, { status: "ok" }>
): PortalAuthorizationFailure {
  return resolution.status === "multiple_organizations"
    ? { ok: false, status: 409, body: { error: "multiple_organizations" } }
    : { ok: false, status: 403, body: { error: "forbidden_org" } }
}

export function getReadableRequest(
  repo: HelpdeskRepository,
  id: string,
  scope: PortalReadScope
) {
  return scope.isStaff
    ? repo.getOrganizationRequestById(id)
    : repo.getRequestForOrganization(id, scope.organizationId)
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
    comments: comments?.flatMap((comment) => {
      const body = getSharedLinearCommentBody(record, comment)
      return body ? [serializeLinearComment({ ...comment, body })] : []
    }),
  }
}

export function serializeLinearComment(comment: LinearIssueCommentSnapshot) {
  return {
    ...comment,
    createdAt: comment.createdAt.toISOString(),
  }
}
