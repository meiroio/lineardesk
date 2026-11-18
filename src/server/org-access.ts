import { and, eq, sql } from "drizzle-orm"
import type { NodePgDatabase } from "drizzle-orm/node-postgres"

import { getDb } from "./db/client"
import type * as schema from "./db/schema"
import {
  authInvitations,
  authMembers,
  authOrganizations,
  authSessions,
  organizationEmailDomains,
} from "./db/schema"
import type {
  AuthSession,
  OrgAccessRepository,
  OrganizationAccessRecord,
  OrganizationMembershipRecord,
  PortalOrganizationResolution,
} from "./types"

type Database = NodePgDatabase<typeof schema>

const PUBLIC_EMAIL_DOMAINS = new Set([
  "126.com",
  "163.com",
  "aol.com",
  "att.net",
  "comcast.net",
  "fastmail.com",
  "fastmail.fm",
  "gmx.com",
  "gmx.net",
  "gmail.com",
  "googlemail.com",
  "hey.com",
  "hushmail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "icloud.com",
  "mail.com",
  "me.com",
  "mac.com",
  "msn.com",
  "qq.com",
  "yahoo.com",
  "ymail.com",
  "rocketmail.com",
  "proton.me",
  "protonmail.com",
  "sbcglobal.net",
  "tutamail.com",
  "tutanota.com",
  "verizon.net",
  "yandex.com",
  "yandex.ru",
  "zoho.com",
])

export function getEmailDomain(email: string): string | null {
  const trimmed = email.trim()
  const atIndex = trimmed.lastIndexOf("@")
  if (atIndex <= 0 || atIndex === trimmed.length - 1) return null

  const domain = trimmed.slice(atIndex + 1).toLowerCase()
  return domain.includes("@") || !domain.includes(".") ? null : domain
}

export function isStaffEmail(email: string): boolean {
  return /^[^@\s]+@meiro\.io$/i.test(email)
}

export function listPortalOrganizations(db: Database = getDb()) {
  return db
    .select({ id: authOrganizations.id, name: authOrganizations.name })
    .from(authOrganizations)
    .orderBy(authOrganizations.name, authOrganizations.id)
}

export function isPublicEmailDomain(domain: string) {
  return PUBLIC_EMAIL_DOMAINS.has(domain.trim().toLowerCase())
}

export function createOrgAccessRepository(
  db: Database = getDb()
): OrgAccessRepository {
  return new DrizzleOrgAccessRepository(db)
}

export async function lockOrganizationInvitation(
  tx: Pick<Database, "execute">,
  organizationId: string,
  email: string
): Promise<void> {
  const key = `lineardesk-invitation:${organizationId}:${email.trim().toLowerCase()}`
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`
  )
}

export function withOrganizationInvitationLock(
  invitationId: string,
  email: string,
  accept: () => Promise<Response>,
  db: Database = getDb()
): Promise<Response | null> {
  return db.transaction(async (tx) => {
    const invitations = await tx
      .select({
        organizationId: authInvitations.organizationId,
        email: authInvitations.email,
      })
      .from(authInvitations)
      .where(
        and(
          eq(authInvitations.id, invitationId),
          eq(authInvitations.email, email)
        )
      )
      .limit(1)
    const invitation = invitations.at(0)
    if (!invitation) return null

    await lockOrganizationInvitation(
      tx,
      invitation.organizationId,
      invitation.email
    )
    // Better Auth reads and writes through its own pool under this lock.
    return accept()
  })
}

class DrizzleOrgAccessRepository implements OrgAccessRepository {
  constructor(private readonly db: Database) {}

  async findActiveOrganizationForEmail(
    email: string
  ): Promise<OrganizationAccessRecord | null> {
    const domain = getEmailDomain(email)
    if (!domain || isPublicEmailDomain(domain)) return null

    const rows = await this.db
      .select({
        organizationId: authOrganizations.id,
        organizationName: authOrganizations.name,
        organizationSlug: authOrganizations.slug,
        domain: organizationEmailDomains.domain,
      })
      .from(organizationEmailDomains)
      .innerJoin(
        authOrganizations,
        eq(organizationEmailDomains.organizationId, authOrganizations.id)
      )
      .where(
        and(
          eq(organizationEmailDomains.domain, domain),
          eq(organizationEmailDomains.active, true)
        )
      )
      .limit(1)

    return rows[0] ?? null
  }

  async listMembershipsForUser(
    userId: string
  ): Promise<OrganizationMembershipRecord[]> {
    return this.db
      .select({
        organizationId: authMembers.organizationId,
        role: authMembers.role,
      })
      .from(authMembers)
      .where(eq(authMembers.userId, userId))
  }

  async hasMembership(userId: string, organizationId: string) {
    const rows = await this.db
      .select({ id: authMembers.id })
      .from(authMembers)
      .where(
        and(
          eq(authMembers.userId, userId),
          eq(authMembers.organizationId, organizationId)
        )
      )
      .limit(1)
    return rows.length > 0
  }

  async setActiveOrganizationForSession(input: {
    sessionToken: string
    organizationId: string
  }) {
    await this.db
      .update(authSessions)
      .set({
        activeOrganizationId: input.organizationId,
        updatedAt: new Date(),
      })
      .where(eq(authSessions.token, input.sessionToken))
  }
}

export async function resolvePortalOrganization(
  session: AuthSession,
  orgAccess: OrgAccessRepository
): Promise<PortalOrganizationResolution> {
  if (
    session.activeOrganizationId &&
    (await orgAccess.hasMembership(
      session.user.id,
      session.activeOrganizationId
    ))
  ) {
    return { status: "ok", organizationId: session.activeOrganizationId }
  }

  const memberships = await orgAccess.listMembershipsForUser(session.user.id)
  if (memberships.length === 1) {
    const [membership] = memberships
    if (session.sessionToken) {
      await orgAccess.setActiveOrganizationForSession({
        sessionToken: session.sessionToken,
        organizationId: membership.organizationId,
      })
    }
    return { status: "ok", organizationId: membership.organizationId }
  }
  if (memberships.length > 1) {
    return { status: "multiple_organizations" }
  }

  return { status: "forbidden" }
}
