import { randomUUID } from "node:crypto"
import process from "node:process"

import { eq, sql } from "drizzle-orm"

import { getDb } from "../src/server/db/client"
import {
  authOrganizations,
  helpdeskRequests,
  organizationEmailDomains,
} from "../src/server/db/schema"
import { getEmailDomain, isPublicEmailDomain } from "../src/server/org-access"

const name = required("CUSTOMER_ORG_NAME")
const slug = required("CUSTOMER_ORG_SLUG")
const domains = required("CUSTOMER_EMAIL_DOMAINS")
  .split(",")
  .map((domain) => domain.trim().toLowerCase())
  .filter(Boolean)

if (domains.length === 0) {
  throw new Error("CUSTOMER_EMAIL_DOMAINS must include at least one domain")
}
for (const domain of domains) {
  if (domain.includes("@") || !domain.includes(".")) {
    throw new Error(`Invalid domain: ${domain}`)
  }
  if (isPublicEmailDomain(domain)) {
    throw new Error(`Refusing to seed public email domain: ${domain}`)
  }
}

const db = getDb()
const existing = await db
  .select({ id: authOrganizations.id })
  .from(authOrganizations)
  .where(eq(authOrganizations.slug, slug))
  .limit(1)

const organizationId = existing[0]?.id ?? randomUUID()

await db
  .insert(authOrganizations)
  .values({ id: organizationId, name, slug })
  .onConflictDoUpdate({
    target: authOrganizations.slug,
    set: { name, updatedAt: new Date() },
  })

for (const domain of domains) {
  await db
    .insert(organizationEmailDomains)
    .values({ organizationId, domain, active: true })
    .onConflictDoUpdate({
      target: organizationEmailDomains.domain,
      set: { organizationId, active: true, updatedAt: new Date() },
    })
}

const rows = await db.select().from(helpdeskRequests)
for (const row of rows) {
  if (row.organizationId !== null) continue
  const domain = getEmailDomain(row.requesterEmail)
  if (domain && domains.includes(domain)) {
    await db
      .update(helpdeskRequests)
      .set({ organizationId, updatedAt: new Date() })
      .where(eq(helpdeskRequests.id, row.id))
  }
}

const unmapped = await db
  .select({
    requesterEmail: helpdeskRequests.requesterEmail,
  })
  .from(helpdeskRequests)
  .where(sql`${helpdeskRequests.organizationId} is null`)

console.log(
  JSON.stringify(
    {
      organizationId,
      slug,
      domains,
      unmappedRequesterEmails: Array.from(
        new Set(unmapped.map((row) => row.requesterEmail))
      ),
    },
    null,
    2
  )
)

function required(name: string) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}
