import { randomUUID } from "node:crypto"
import process from "node:process"

import { and, eq, inArray, isNull } from "drizzle-orm"

import { closeDb, getDb } from "../src/server/db/client"
import {
  authOrganizations,
  helpdeskRequests,
  organizationEmailDomains,
} from "../src/server/db/schema"
import { getEmailDomain, isPublicEmailDomain } from "../src/server/org-access"

type Database = ReturnType<typeof getDb>

export type SeedCustomerOrganizationInput = {
  name: string
  slug: string
  domains: string[]
}

export type SeedCustomerOrganizationSummary = {
  organizationId: string
  slug: string
  domains: string[]
  unmappedRequesterEmails: string[]
  backfilledRequestCount: number
  unmappedRequesterEmailCount: number
}

type DomainMapping = {
  domain: string
  organizationId: string
}

type BackfillCandidate = {
  requesterEmail: string
  organizationId: string | null
}

export function normalizeCustomerDomains(value: string) {
  const domains = Array.from(
    new Set(
      value
        .split(",")
        .map((domain) => domain.trim().toLowerCase())
        .filter(Boolean)
    )
  )

  if (domains.length === 0) {
    throw new Error("CUSTOMER_EMAIL_DOMAINS must include at least one domain")
  }
  for (const domain of domains) validateCustomerDomain(domain)

  return domains
}

export function assertNoDomainOwnershipConflicts(
  mappings: DomainMapping[],
  organizationId: string
) {
  const conflict = mappings.find(
    (mapping) => mapping.organizationId !== organizationId
  )
  if (conflict) {
    throw new Error(
      `Email domain ${conflict.domain} is already mapped to organization ${conflict.organizationId}; refusing to transfer ownership`
    )
  }
}

export function shouldBackfillRequest(
  request: BackfillCandidate,
  domains: string[]
) {
  if (request.organizationId !== null) return false

  const domain = getEmailDomain(request.requesterEmail)
  return domain ? domains.includes(domain) : false
}

export function readSeedInputFromEnv(
  env: NodeJS.ProcessEnv = process.env
): SeedCustomerOrganizationInput {
  return {
    name: required("CUSTOMER_ORG_NAME", env),
    slug: required("CUSTOMER_ORG_SLUG", env),
    domains: normalizeCustomerDomains(required("CUSTOMER_EMAIL_DOMAINS", env)),
  }
}

export async function seedCustomerOrganization(
  db: Database,
  input: SeedCustomerOrganizationInput
): Promise<SeedCustomerOrganizationSummary> {
  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: authOrganizations.id })
      .from(authOrganizations)
      .where(eq(authOrganizations.slug, input.slug))
      .limit(1)

    const proposedOrganizationId = existing[0]?.id ?? randomUUID()
    const updatedAt = new Date()

    const [organization] = await tx
      .insert(authOrganizations)
      .values({
        id: proposedOrganizationId,
        name: input.name,
        slug: input.slug,
      })
      .onConflictDoUpdate({
        target: authOrganizations.slug,
        set: { name: input.name, updatedAt },
      })
      .returning({ id: authOrganizations.id })
    const organizationId = organization?.id ?? proposedOrganizationId

    const mappedDomains = await tx
      .select({
        domain: organizationEmailDomains.domain,
        organizationId: organizationEmailDomains.organizationId,
      })
      .from(organizationEmailDomains)
      .where(inArray(organizationEmailDomains.domain, input.domains))

    assertNoDomainOwnershipConflicts(mappedDomains, organizationId)

    for (const domain of input.domains) {
      const rows = await tx
        .insert(organizationEmailDomains)
        .values({ organizationId, domain, active: true })
        .onConflictDoUpdate({
          target: organizationEmailDomains.domain,
          set: { active: true, updatedAt: new Date() },
          setWhere: eq(organizationEmailDomains.organizationId, organizationId),
        })
        .returning({ domain: organizationEmailDomains.domain })

      if (rows.length === 0) {
        throw new Error(
          `Email domain ${domain} is already mapped to another organization; refusing to transfer ownership`
        )
      }
    }

    const requests = await tx
      .select({
        id: helpdeskRequests.id,
        requesterEmail: helpdeskRequests.requesterEmail,
        organizationId: helpdeskRequests.organizationId,
      })
      .from(helpdeskRequests)

    let backfilledRequestCount = 0
    for (const request of requests) {
      if (!shouldBackfillRequest(request, input.domains)) continue

      const updated = await tx
        .update(helpdeskRequests)
        .set({ organizationId, updatedAt: new Date() })
        .where(
          and(
            eq(helpdeskRequests.id, request.id),
            isNull(helpdeskRequests.organizationId)
          )
        )
        .returning({ id: helpdeskRequests.id })

      backfilledRequestCount += updated.length
    }

    const unmapped = await tx
      .select({
        requesterEmail: helpdeskRequests.requesterEmail,
      })
      .from(helpdeskRequests)
      .where(isNull(helpdeskRequests.organizationId))
    const unmappedRequesterEmails = Array.from(
      new Set(unmapped.map((row) => row.requesterEmail))
    )

    return {
      organizationId,
      slug: input.slug,
      domains: input.domains,
      unmappedRequesterEmails,
      backfilledRequestCount,
      unmappedRequesterEmailCount: unmappedRequesterEmails.length,
    }
  })
}

export async function main() {
  try {
    const input = readSeedInputFromEnv()
    const summary = await seedCustomerOrganization(getDb(), input)

    console.log(JSON.stringify(summary, null, 2))
  } finally {
    await closeDb()
  }
}

if (import.meta.main) {
  await main()
}

function validateCustomerDomain(domain: string) {
  if (
    domain.includes("@") ||
    !domain.includes(".") ||
    domain.startsWith(".") ||
    domain.endsWith(".") ||
    domain.length > 253
  ) {
    throw new Error(`Invalid domain: ${domain}`)
  }

  const labels = domain.split(".")
  if (
    labels.some(
      (label) =>
        label.length === 0 ||
        label.length > 63 ||
        !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
    )
  ) {
    throw new Error(`Invalid domain: ${domain}`)
  }

  if (isPublicEmailDomain(domain)) {
    throw new Error(`Refusing to seed public email domain: ${domain}`)
  }
}

function required(name: string, env: NodeJS.ProcessEnv) {
  const value = env[name]?.trim()
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}
