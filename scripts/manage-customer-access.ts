import { randomUUID } from "node:crypto"
import process from "node:process"

import { and, eq, gt, inArray } from "drizzle-orm"

import { readAppConfig } from "../src/server/config"
import { closeDb, getDb } from "../src/server/db/client"
import {
  authInvitations,
  authMembers,
  authOrganizations,
  authUsers,
} from "../src/server/db/schema"
import { createEmailSender } from "../src/server/email"
import { lockOrganizationInvitation } from "../src/server/org-access"

type Target = { organizationSlug: string; email: string }
type Recipient = { organizationId: string; email: string }
type Database = ReturnType<typeof getDb>

type CustomerAccessInput = Target &
  ({ action: "invite"; operatorEmail: string } | { action: "revoke" })

export function readCustomerAccessArgs(args: string[]): CustomerAccessInput {
  const [action, , email, operatorEmail] = args
  const organizationSlug = args.at(1)?.trim()
  if (!organizationSlug) throw new Error(usage)

  if (action === "invite" && args.length === 4) {
    return {
      action,
      organizationSlug,
      email: normalizeEmail(email),
      operatorEmail: normalizeEmail(operatorEmail),
    }
  }

  if (action === "revoke" && args.length === 3) {
    return { action, organizationSlug, email: normalizeEmail(email) }
  }

  throw new Error(usage)
}

const usage =
  "Usage: bun run org:access invite <organization-slug> <customer-email> <operator-email>\n" +
  "       bun run org:access revoke <organization-slug> <customer-email>"

function normalizeEmail(value: string) {
  const email = value.trim().toLowerCase()
  if (email.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) {
    throw new Error("Expected a valid email address")
  }
  return email
}

export async function updateCustomerAccess(
  db: Database,
  input: CustomerAccessInput
) {
  return db.transaction(async (tx) => {
    const { action, email, organizationSlug } = input
    const organizations = await tx
      .select({ id: authOrganizations.id, name: authOrganizations.name })
      .from(authOrganizations)
      .where(eq(authOrganizations.slug, organizationSlug))
    const organization = organizations.at(0)
    if (!organization)
      throw new Error(`Unknown organization: ${organizationSlug}`)

    const recipient = { organizationId: organization.id, email }
    await lockOrganizationInvitation(tx, recipient.organizationId, email)

    const matchingMembership = and(
      eq(authMembers.organizationId, recipient.organizationId),
      inArray(
        authMembers.userId,
        tx
          .select({ id: authUsers.id })
          .from(authUsers)
          .where(eq(authUsers.email, email))
      )
    )

    if (action === "revoke") {
      const canceled = await tx
        .update(authInvitations)
        .set({ status: "canceled" })
        .where(pendingInvitationFor(recipient))
        .returning({ id: authInvitations.id })
      const removed = await tx
        .delete(authMembers)
        .where(matchingMembership)
        .returning({ id: authMembers.id })

      return {
        action,
        canceledInvitations: canceled.length,
        removedMemberships: removed.length,
      }
    }

    const members = await tx
      .select({ id: authMembers.id })
      .from(authMembers)
      .where(matchingMembership)
      .limit(1)
    if (members.length > 0)
      throw new Error("This email is already a member of the organization")

    const invitation = await prepareInvitation(
      tx,
      recipient,
      input.operatorEmail
    )
    return {
      action,
      ...invitation,
      organizationName: organization.name,
    }
  })
}

function pendingInvitationFor(recipient: Recipient) {
  return and(
    eq(authInvitations.organizationId, recipient.organizationId),
    eq(authInvitations.email, recipient.email),
    eq(authInvitations.status, "pending")
  )
}

async function prepareInvitation(
  tx: Pick<Database, "select" | "insert">,
  recipient: Recipient,
  operatorEmail: string
) {
  if (operatorEmail === recipient.email) {
    await tx
      .insert(authUsers)
      .values({
        id: randomUUID(),
        name: "LinearDesk operator",
        email: operatorEmail,
        emailVerified: false,
      })
      .onConflictDoNothing({ target: authUsers.email })
  }

  const operators = await tx
    .select({ id: authUsers.id, name: authUsers.name })
    .from(authUsers)
    .where(eq(authUsers.email, operatorEmail))
  const operator = operators.at(0)
  if (!operator)
    throw new Error("Operator email must belong to an existing user")

  const now = new Date()
  const invitations = await tx
    .select({
      invitationId: authInvitations.id,
      role: authInvitations.role,
      inviterName: authUsers.name,
    })
    .from(authInvitations)
    .innerJoin(authUsers, eq(authUsers.id, authInvitations.inviterId))
    .where(
      and(pendingInvitationFor(recipient), gt(authInvitations.expiresAt, now))
    )
    .limit(2)
  const pending = invitations.at(0)
  if (invitations.length > 1 || (pending && pending.role !== "member")) {
    throw new Error(
      "Cancel conflicting invitations for this email before inviting again"
    )
  }
  if (pending)
    return {
      invitationId: pending.invitationId,
      inviterName: pending.inviterName,
    }

  const invitationId = randomUUID()
  await tx.insert(authInvitations).values({
    id: invitationId,
    ...recipient,
    role: "member",
    expiresAt: new Date(now.getTime() + 48 * 60 * 60 * 1000),
    inviterId: operator.id,
  })
  return { invitationId, inviterName: operator.name }
}

async function main() {
  const input = readCustomerAccessArgs(process.argv.slice(2))
  const config = readAppConfig()
  const invitationUrl = new URL("/login", config.betterAuthUrl)

  try {
    const result = await updateCustomerAccess(getDb(), input)
    if (result.action === "revoke") {
      console.log(
        `Removed ${result.removedMemberships} memberships and canceled ${result.canceledInvitations} invitations.`
      )
      return
    }

    invitationUrl.searchParams.set("invitationId", result.invitationId)
    await createEmailSender(config.email).sendInvitation({
      email: input.email,
      url: invitationUrl.toString(),
      inviterName: result.inviterName,
      organizationName: result.organizationName,
      role: "member",
    })
    console.log(
      `Invitation ${config.email.provider === "log" ? "logged" : "sent"} for ${input.email}.`
    )
  } finally {
    await closeDb()
  }
}

if (import.meta.main) {
  await main()
}
