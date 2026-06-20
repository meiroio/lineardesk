import { randomUUID } from "node:crypto"

import { and, eq } from "drizzle-orm"
import type { NodePgDatabase } from "drizzle-orm/node-postgres"

import { getDb } from "./db/client"
import type * as schema from "./db/schema"
import {
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
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "yahoo.com",
  "proton.me",
  "protonmail.com",
])

export function getEmailDomain(email: string): string | null {
  const trimmed = email.trim()
  const atIndex = trimmed.lastIndexOf("@")
  if (atIndex <= 0 || atIndex === trimmed.length - 1) return null

  const domain = trimmed.slice(atIndex + 1).toLowerCase()
  return domain.includes("@") || !domain.includes(".") ? null : domain
}

export function isPublicEmailDomain(domain: string) {
  return PUBLIC_EMAIL_DOMAINS.has(domain.toLowerCase())
}

export function createOrgAccessRepository(
  db: Database = getDb()
): OrgAccessRepository {
  return new DrizzleOrgAccessRepository(db)
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

  async ensureMember(input: {
    userId: string
    organizationId: string
    role: "member" | "admin" | "owner"
  }) {
    await this.db
      .insert(authMembers)
      .values({
        id: randomUUID(),
        organizationId: input.organizationId,
        userId: input.userId,
        role: input.role,
      })
      .onConflictDoNothing({
        target: [authMembers.organizationId, authMembers.userId],
      })
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

  const domainOrg = await orgAccess.findActiveOrganizationForEmail(
    session.user.email
  )
  if (domainOrg) {
    await orgAccess.ensureMember({
      userId: session.user.id,
      organizationId: domainOrg.organizationId,
      role: "member",
    })
    if (session.sessionToken) {
      await orgAccess.setActiveOrganizationForSession({
        sessionToken: session.sessionToken,
        organizationId: domainOrg.organizationId,
      })
    }
    return { status: "ok", organizationId: domainOrg.organizationId }
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
  if (memberships.length > 1) return { status: "multiple_organizations" }

  return { status: "forbidden" }
}
