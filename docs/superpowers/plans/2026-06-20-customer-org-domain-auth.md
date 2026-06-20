# Customer Org Domain Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Better Auth magic-link login and Better Auth organization-backed, domain-scoped customer ticket access.

**Architecture:** Better Auth remains the session/auth system. LinearDesk adds a small email adapter, a custom organization-domain table, and an org-access service that enrolls verified users into Better Auth organizations by email domain, then scopes all request APIs by `organization_id`.

**Tech Stack:** TanStack Start, React, Elysia, Better Auth, Drizzle ORM, Postgres, Vitest, Resend HTTP API for transactional email.

---

## Scope Check

The approved spec covers one coherent feature: customer organization access. It touches auth, schema, API authorization, Slack ticket creation, login UI, and docs. Those pieces must ship together because partial email-domain auth without org-scoped APIs would expose the wrong data model.

The implementation should preserve existing Google login and existing Slack intake behavior while changing the authorization boundary from requester email to customer organization.

## File Structure

- `src/server/email.ts` - provider-agnostic transactional email adapter; first provider is Resend plus a local log provider.
- `src/server/org-access.ts` - email-domain normalization, public-domain rejection, org-domain lookup, membership enrollment, active-org resolution.
- `src/server/auth.ts` - Better Auth plugins: `magicLink` and `organization`; domain gate for new users; email callbacks.
- `src/lib/auth-client.ts` - Better Auth client plugin setup for magic links and organizations.
- `src/server/db/schema.ts` - Better Auth organization tables, organization-domain table, `session.activeOrganizationId`, `helpdesk_requests.organization_id`.
- `src/server/types.ts` - email config, org-aware auth/session/request/repository types.
- `src/server/config.ts` - remove env-domain allowlist as source of truth; parse email provider env.
- `src/server/repository.ts` - request persistence and lookup by `organization_id`.
- `src/server/app.ts` - org-aware API authorization and request creation.
- `src/server/route-auth.ts` / `src/lib/route-guards.ts` - route-level auth state now resolves an organization.
- `src/server/slack/ticket.ts` - Slack tickets resolve org by Slack email before creating Linear issues.
- `src/routes/login.tsx` - Google plus magic-link login UI; blocked-state message.
- `src/routes/index.tsx` - copy updates because the list now shows org tickets, not only the signed-in user's tickets.
- `scripts/seed-customer-org.ts` - operator script to create/update a customer org/domain mapping and backfill existing tickets for those domains.
- `.env.example`, `README.md`, `docs/USER_GUIDE.md` - document env, rollout, and org-wide visibility.

Existing dirty files: `README.md` is modified and `docs/USER_GUIDE.md` is untracked at planning time. During execution, read and preserve those user changes before editing docs.

## Better Auth References

- Magic link plugin: server `magicLink({ sendMagicLink })`, client `magicLinkClient()`, default 5-minute expiry, single-use atomic token consumption, optional hashed token storage.
- Organization plugin: adds `organization`, `member`, `invitation`, and `session.activeOrganizationId`; server endpoints include `setActiveOrganization`, `listMembers`, `addMember`; invitation emails require `sendInvitationEmail`.
- The normal `addMember` endpoint is permission-gated. Domain auto-enrollment is trusted server-side work, so `src/server/org-access.ts` writes the Better Auth `member` table directly and idempotently.

---

### Task 1: Email Config and Transactional Email Adapter

**Files:**
- Modify: `src/server/types.ts`
- Modify: `src/server/config.ts`
- Modify: `src/server/__tests__/config.test.ts`
- Create: `src/server/email.ts`
- Create: `src/server/__tests__/email.test.ts`

- [ ] **Step 1: Write failing config tests**

Replace the domain-allowlist tests in `src/server/__tests__/config.test.ts` with email-provider config tests while keeping Slack/Gemini coverage.

```ts
import { describe, expect, it } from "vitest"

import { readAppConfig } from "../config"

const base = {
  DATABASE_URL: "postgres://x@localhost:5432/x",
  BETTER_AUTH_SECRET: "s",
  BETTER_AUTH_URL: "http://localhost:3000",
  GOOGLE_CLIENT_ID: "g",
  GOOGLE_CLIENT_SECRET: "gs",
  LINEAR_API_KEY: "lin",
  LINEAR_WEBHOOK_SECRET: "wh",
}

describe("readAppConfig email", () => {
  it("uses the local log email provider by default", () => {
    expect(readAppConfig(base).email).toEqual({
      provider: "log",
      appName: "LinearDesk",
      from: "LinearDesk <noreply@lineardesk.local>",
    })
  })

  it("enables Resend when RESEND_API_KEY is present", () => {
    expect(
      readAppConfig({
        ...base,
        RESEND_API_KEY: "re_123",
        EMAIL_FROM: "LinearDesk <support@example.com>",
        EMAIL_APP_NAME: "Desk",
      }).email
    ).toEqual({
      provider: "resend",
      appName: "Desk",
      from: "LinearDesk <support@example.com>",
      resendApiKey: "re_123",
    })
  })

  it("rejects EMAIL_PROVIDER=resend without a key", () => {
    expect(() =>
      readAppConfig({ ...base, EMAIL_PROVIDER: "resend" })
    ).toThrow("RESEND_API_KEY")
  })
})
```

Keep the existing Slack, Gemini, and Linear default tests, but remove `ALLOWED_EMAIL_DOMAINS` from their base env objects.

- [ ] **Step 2: Run config tests and verify they fail**

Run:

```bash
bun run test src/server/__tests__/config.test.ts
```

Expected: FAIL because `AppConfig.email` and the new email env parsing do not exist yet.

- [ ] **Step 3: Add email config types**

In `src/server/types.ts`, remove `allowedEmailDomains` from `AppConfig` and add:

```ts
export type EmailConfig = {
  provider: "log" | "resend"
  appName: string
  from: string
  resendApiKey?: string
}

export type AppConfig = {
  email: EmailConfig
  databaseUrl: string
  betterAuthSecret: string
  betterAuthUrl: string
  googleClientId: string
  googleClientSecret: string
  linear: {
    apiKey: string
    teamId: string
    teamKey: string
    initialStateName: string
    labelName: string
    webhookSecret: string
  }
  slack?: {
    signingSecret: string
    botToken: string
  }
  gemini?: {
    apiKey: string
    model: string
  }
}
```

- [ ] **Step 4: Implement email env parsing**

In `src/server/config.ts`, delete `parseAllowedDomains` and `isAllowedEmail`. Add:

```ts
function readEmailConfig(env: Env): AppConfig["email"] {
  const explicitProvider = env.EMAIL_PROVIDER?.trim().toLowerCase()
  const resendApiKey = env.RESEND_API_KEY?.trim()
  const provider = explicitProvider || (resendApiKey ? "resend" : "log")

  if (provider !== "resend" && provider !== "log") {
    throw new Error("EMAIL_PROVIDER must be 'resend' or 'log'")
  }
  if (provider === "resend" && !resendApiKey) {
    throw new Error("Missing required environment variable: RESEND_API_KEY")
  }

  return {
    provider,
    appName: env.EMAIL_APP_NAME?.trim() || "LinearDesk",
    from: env.EMAIL_FROM?.trim() || "LinearDesk <noreply@lineardesk.local>",
    ...(resendApiKey ? { resendApiKey } : {}),
  }
}
```

Then add `email: readEmailConfig(env),` to the object returned by `readAppConfig`, and remove the old `allowedEmailDomains` assignment.

- [ ] **Step 5: Add failing email adapter tests**

Create `src/server/__tests__/email.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"

import { createEmailSender } from "../email"

describe("createEmailSender", () => {
  it("sends magic links through Resend", async () => {
    const fetchMock = vi.fn(async () => Response.json({ id: "em_123" }))
    const sender = createEmailSender(
      {
        provider: "resend",
        appName: "LinearDesk",
        from: "LinearDesk <support@example.com>",
        resendApiKey: "re_123",
      },
      fetchMock
    )

    await sender.sendMagicLink({
      to: "ada@example.com",
      url: "https://desk.example.com/api/auth/magic-link/verify?token=abc",
      expiresInMinutes: 5,
    })

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer re_123",
          "content-type": "application/json",
        }),
        body: expect.stringContaining("Your LinearDesk sign-in link"),
      })
    )
  })

  it("throws when Resend returns a non-2xx response", async () => {
    const fetchMock = vi.fn(
      async () => new Response("bad", { status: 401, statusText: "Unauthorized" })
    )
    const sender = createEmailSender(
      {
        provider: "resend",
        appName: "LinearDesk",
        from: "LinearDesk <support@example.com>",
        resendApiKey: "re_bad",
      },
      fetchMock
    )

    await expect(
      sender.sendInvitation({
        to: "ada@example.com",
        inviteUrl: "https://desk.example.com/login?invitationId=inv_1",
        organizationName: "Acme",
        inviterEmail: "owner@example.com",
        role: "member",
        expiresInDays: 2,
      })
    ).rejects.toThrow("Resend email failed")
  })

  it("logs in local mode without calling fetch", async () => {
    const fetchMock = vi.fn()
    const sender = createEmailSender(
      {
        provider: "log",
        appName: "LinearDesk",
        from: "LinearDesk <noreply@lineardesk.local>",
      },
      fetchMock
    )

    await sender.sendMagicLink({
      to: "ada@example.com",
      url: "https://desk.example.com/magic",
      expiresInMinutes: 5,
    })

    expect(fetchMock).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 6: Run email tests and verify they fail**

Run:

```bash
bun run test src/server/__tests__/email.test.ts
```

Expected: FAIL because `src/server/email.ts` does not exist.

- [ ] **Step 7: Implement `src/server/email.ts`**

Create:

```ts
import type { EmailConfig } from "./types"

type FetchLike = typeof fetch

export type MagicLinkEmailInput = {
  to: string
  url: string
  expiresInMinutes: number
}

export type InvitationEmailInput = {
  to: string
  inviteUrl: string
  organizationName: string
  inviterEmail: string
  role: string
  expiresInDays: number
}

export type EmailSender = {
  sendMagicLink: (input: MagicLinkEmailInput) => Promise<void>
  sendInvitation: (input: InvitationEmailInput) => Promise<void>
}

export function createEmailSender(
  config: EmailConfig,
  fetchFn: FetchLike = fetch
): EmailSender {
  if (config.provider === "log") return createLogEmailSender(config)
  return createResendEmailSender(config, fetchFn)
}

function createLogEmailSender(config: EmailConfig): EmailSender {
  return {
    async sendMagicLink(input) {
      console.info("magic link email", {
        appName: config.appName,
        to: input.to,
        url: input.url,
      })
    },
    async sendInvitation(input) {
      console.info("invitation email", {
        appName: config.appName,
        to: input.to,
        inviteUrl: input.inviteUrl,
        organizationName: input.organizationName,
      })
    },
  }
}

function createResendEmailSender(
  config: EmailConfig & { provider: "resend" },
  fetchFn: FetchLike
): EmailSender {
  return {
    sendMagicLink: (input) =>
      sendResendEmail(config, fetchFn, {
        to: input.to,
        subject: "Your LinearDesk sign-in link",
        html: [
          `<p>Use this link to sign in to ${escapeHtml(config.appName)}:</p>`,
          `<p><a href="${escapeHtml(input.url)}">Sign in to ${escapeHtml(
            config.appName
          )}</a></p>`,
          `<p>This link expires in ${input.expiresInMinutes} minutes.</p>`,
        ].join(""),
        text: `Use this link to sign in to ${config.appName}: ${input.url}\n\nThis link expires in ${input.expiresInMinutes} minutes.`,
      }),
    sendInvitation: (input) =>
      sendResendEmail(config, fetchFn, {
        to: input.to,
        subject: `You're invited to ${input.organizationName} on LinearDesk`,
        html: [
          `<p>${escapeHtml(input.inviterEmail)} invited you to join ${escapeHtml(
            input.organizationName
          )} as ${escapeHtml(input.role)}.</p>`,
          `<p><a href="${escapeHtml(input.inviteUrl)}">Accept invitation</a></p>`,
          `<p>This invitation expires in ${input.expiresInDays} days.</p>`,
        ].join(""),
        text: `${input.inviterEmail} invited you to join ${input.organizationName} as ${input.role}.\n\nAccept invitation: ${input.inviteUrl}\n\nThis invitation expires in ${input.expiresInDays} days.`,
      }),
  }
}

async function sendResendEmail(
  config: EmailConfig & { provider: "resend" },
  fetchFn: FetchLike,
  input: { to: string; subject: string; html: string; text: string }
) {
  const response = await fetchFn("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.resendApiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: config.from,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
    }),
  })

  if (!response.ok) {
    throw new Error(
      `Resend email failed with ${response.status} ${response.statusText}`
    )
  }
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}
```

- [ ] **Step 8: Run task tests**

Run:

```bash
bun run test src/server/__tests__/config.test.ts src/server/__tests__/email.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/server/types.ts src/server/config.ts src/server/email.ts src/server/__tests__/config.test.ts src/server/__tests__/email.test.ts
git commit -m "feat: add transactional email adapter"
```

---

### Task 2: Database Schema for Organizations, Domains, and Ticket Org IDs

**Files:**
- Modify: `src/server/db/schema.ts`
- Modify: `src/server/types.ts`
- Modify: `src/server/__tests__/repository-shape.test.ts`
- Migration: generated under `drizzle/`

- [ ] **Step 1: Write failing row-shape test**

Update `src/server/__tests__/repository-shape.test.ts` so both row fixtures include `organizationId: "org-1"`, and assert it is carried:

```ts
expect(record.organizationId).toBe("org-1")
```

The row fixture property must be camelCase because it calls `toRequestRecord` directly:

```ts
organizationId: "org-1",
```

- [ ] **Step 2: Run test and verify it fails**

Run:

```bash
bun run test src/server/__tests__/repository-shape.test.ts
```

Expected: FAIL because `toRequestRecord` does not return `organizationId`.

- [ ] **Step 3: Add schema tables and columns**

In `src/server/db/schema.ts`, add `uniqueIndex` to the imports from `drizzle-orm/pg-core`.

Add Better Auth organization tables after `authVerifications`:

```ts
export const authOrganizations = pgTable("organization", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  logo: text("logo"),
  createdAt: timestamp("createdAt", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updatedAt", { withTimezone: true })
    .notNull()
    .defaultNow(),
})

export const authMembers = pgTable(
  "member",
  {
    id: text("id").primaryKey(),
    organizationId: text("organizationId")
      .notNull()
      .references(() => authOrganizations.id, { onDelete: "cascade" }),
    userId: text("userId")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("member_userId_idx").on(table.userId),
    index("member_organizationId_idx").on(table.organizationId),
    uniqueIndex("member_organizationId_userId_unique").on(
      table.organizationId,
      table.userId
    ),
  ]
)

export const authInvitations = pgTable(
  "invitation",
  {
    id: text("id").primaryKey(),
    organizationId: text("organizationId")
      .notNull()
      .references(() => authOrganizations.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role").notNull(),
    status: text("status").notNull().default("pending"),
    expiresAt: timestamp("expiresAt", { withTimezone: true }),
    inviterId: text("inviterId")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("invitation_email_idx").on(table.email),
    index("invitation_organizationId_idx").on(table.organizationId),
  ]
)
```

Add Better Auth's organization session field to `authSessions`:

```ts
activeOrganizationId: text("activeOrganizationId"),
```

Add the domain table:

```ts
export const organizationEmailDomains = pgTable(
  "organization_email_domains",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => authOrganizations.id, { onDelete: "cascade" }),
    domain: text("domain").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("organization_email_domains_domain_unique").on(table.domain),
    index("organization_email_domains_organization_id_idx").on(
      table.organizationId
    ),
  ]
)
```

Add nullable `organizationId` to `helpdeskRequests`:

```ts
organizationId: text("organization_id").references(() => authOrganizations.id),
```

Add an index to `helpdeskRequests`:

```ts
index("helpdesk_requests_organization_id_idx").on(table.organizationId),
```

- [ ] **Step 4: Update request types and row mapper**

In `src/server/types.ts`, add to `RequestRecord`:

```ts
organizationId: string | null
```

Add to `CreateRequestRecordInput`:

```ts
organizationId: string
```

In `src/server/repository.ts`, include `organizationId` in `createRequest` values and `toRequestRecord`:

```ts
organizationId: input.organizationId,
```

and:

```ts
organizationId: row.organizationId,
```

Update every `RequestRecord` fixture in `src/server/__tests__` to include:

```ts
organizationId: "org-1",
```

This includes `app.test.ts`, `slack-routes.test.ts`, `reconcile.test.ts`, and `repository-shape.test.ts`.

- [ ] **Step 5: Run row-shape test**

Run:

```bash
bun run test src/server/__tests__/repository-shape.test.ts
```

Expected: PASS.

- [ ] **Step 6: Generate migration**

Run:

```bash
bun run db:generate
```

Expected: a new `drizzle/0006_*.sql` and `drizzle/meta/0006_snapshot.json` are generated. Confirm the SQL contains:

```sql
CREATE TABLE "organization"
CREATE TABLE "member"
CREATE TABLE "invitation"
CREATE TABLE "organization_email_domains"
ALTER TABLE "session" ADD COLUMN "activeOrganizationId" text
ALTER TABLE "helpdesk_requests" ADD COLUMN "organization_id" text
```

Do not manually add `NOT NULL` to `helpdesk_requests.organization_id` in this migration. The production rollout backfills first, then enforces not-null in a separate migration.

- [ ] **Step 7: Commit**

```bash
git add src/server/db/schema.ts src/server/types.ts src/server/repository.ts src/server/__tests__/repository-shape.test.ts drizzle
git commit -m "feat: add customer organization schema"
```

---

### Task 3: Organization Access Resolver

**Files:**
- Create: `src/server/org-access.ts`
- Create: `src/server/__tests__/org-access.test.ts`
- Modify: `src/server/types.ts`

- [ ] **Step 1: Write failing org-access tests**

Create `src/server/__tests__/org-access.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"

import {
  getEmailDomain,
  isPublicEmailDomain,
  resolvePortalOrganization,
} from "../org-access"
import type { AuthSession, OrgAccessRepository } from "../types"

const session: AuthSession = {
  user: { id: "user-1", email: "Ada@Example.COM", name: "Ada" },
  activeOrganizationId: null,
  sessionToken: "session-token",
}

function repo(
  overrides: Partial<OrgAccessRepository> = {}
): OrgAccessRepository {
  return {
    findActiveOrganizationForEmail: vi.fn(async () => ({
      organizationId: "org-1",
      organizationName: "Example",
      organizationSlug: "example",
      domain: "example.com",
    })),
    ensureMember: vi.fn(async () => undefined),
    listMembershipsForUser: vi.fn(async () => []),
    hasMembership: vi.fn(async () => false),
    setActiveOrganizationForSession: vi.fn(async () => undefined),
    ...overrides,
  }
}

describe("email domain helpers", () => {
  it("normalizes valid email domains", () => {
    expect(getEmailDomain(" Ada@Example.COM ")).toBe("example.com")
  })

  it("rejects invalid emails", () => {
    expect(getEmailDomain("not-an-email")).toBeNull()
  })

  it("recognizes public domains", () => {
    expect(isPublicEmailDomain("gmail.com")).toBe(true)
    expect(isPublicEmailDomain("example.com")).toBe(false)
  })
})

describe("resolvePortalOrganization", () => {
  it("auto-enrolls a verified domain user", async () => {
    const access = repo()
    await expect(resolvePortalOrganization(session, access)).resolves.toEqual({
      status: "ok",
      organizationId: "org-1",
    })
    expect(access.ensureMember).toHaveBeenCalledWith({
      userId: "user-1",
      organizationId: "org-1",
      role: "member",
    })
    expect(access.setActiveOrganizationForSession).toHaveBeenCalledWith({
      sessionToken: "session-token",
      organizationId: "org-1",
    })
  })

  it("uses an existing active organization membership", async () => {
    const access = repo({
      listMembershipsForUser: vi.fn(async () => [
        { organizationId: "org-1", role: "member" },
      ]),
      hasMembership: vi.fn(async () => true),
    })
    await expect(
      resolvePortalOrganization(
        { ...session, activeOrganizationId: "org-1" },
        access
      )
    ).resolves.toEqual({ status: "ok", organizationId: "org-1" })
    expect(access.ensureMember).not.toHaveBeenCalled()
  })

  it("blocks users with multiple memberships and no active org", async () => {
    const access = repo({
      findActiveOrganizationForEmail: vi.fn(async () => null),
      listMembershipsForUser: vi.fn(async () => [
        { organizationId: "org-1", role: "member" },
        { organizationId: "org-2", role: "member" },
      ]),
    })
    await expect(resolvePortalOrganization(session, access)).resolves.toEqual({
      status: "multiple_organizations",
    })
  })

  it("forbids users without membership or domain access", async () => {
    const access = repo({
      findActiveOrganizationForEmail: vi.fn(async () => null),
    })
    await expect(resolvePortalOrganization(session, access)).resolves.toEqual({
      status: "forbidden",
    })
  })
})
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
bun run test src/server/__tests__/org-access.test.ts
```

Expected: FAIL because `org-access.ts` does not exist.

- [ ] **Step 3: Add auth session and org-access types**

In `src/server/types.ts`, replace `AuthSession` with:

```ts
export type AuthSession = {
  user: {
    id: string
    email: string
    name?: string | null
  }
  activeOrganizationId: string | null
  sessionToken: string | null
}
```

Then update every test `AuthSession` fixture to include:

```ts
activeOrganizationId: "org-1",
sessionToken: "session-token",
```

Also add:

```ts
export type OrganizationAccessRecord = {
  organizationId: string
  organizationName: string
  organizationSlug: string
  domain: string
}

export type OrganizationMembershipRecord = {
  organizationId: string
  role: string
}

export type PortalOrganizationResolution =
  | { status: "ok"; organizationId: string }
  | { status: "forbidden" }
  | { status: "multiple_organizations" }

export type OrgAccessRepository = {
  findActiveOrganizationForEmail: (
    email: string
  ) => Promise<OrganizationAccessRecord | null>
  ensureMember: (input: {
    userId: string
    organizationId: string
    role: "member" | "admin" | "owner"
  }) => Promise<void>
  listMembershipsForUser: (
    userId: string
  ) => Promise<OrganizationMembershipRecord[]>
  hasMembership: (userId: string, organizationId: string) => Promise<boolean>
  setActiveOrganizationForSession: (input: {
    sessionToken: string
    organizationId: string
  }) => Promise<void>
}
```

- [ ] **Step 4: Implement `src/server/org-access.ts`**

Create:

```ts
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
```

- [ ] **Step 5: Run org-access tests**

Run:

```bash
bun run test src/server/__tests__/org-access.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/org-access.ts src/server/__tests__/org-access.test.ts src/server/types.ts
git commit -m "feat: resolve portal organizations by domain"
```

---

### Task 4: Better Auth Magic Link and Organization Plugins

**Files:**
- Modify: `src/server/auth.ts`
- Modify: `src/lib/auth-client.ts`
- Modify: `src/lib/__tests__/auth-client.test.ts`
- Modify: `src/server/types.ts`
- Create: `src/server/__tests__/auth.test.ts`

- [ ] **Step 1: Write failing auth-client plugin test**

Replace `src/lib/__tests__/auth-client.test.ts` with:

```ts
import { describe, expect, it } from "vitest"

import { authClientOptions } from "../auth-client"

describe("auth client", () => {
  it("uses the API auth base path and Better Auth client plugins", () => {
    expect(authClientOptions.basePath).toBe("/api/auth")
    expect(authClientOptions.plugins).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Run auth-client test and verify it fails**

Run:

```bash
bun run test src/lib/__tests__/auth-client.test.ts
```

Expected: FAIL because `plugins` is not configured.

- [ ] **Step 3: Add client plugins**

In `src/lib/auth-client.ts`, replace the file with:

```ts
import { createAuthClient } from "better-auth/react"
import { magicLinkClient, organizationClient } from "better-auth/client/plugins"

export const authClientOptions = {
  basePath: "/api/auth",
  plugins: [magicLinkClient(), organizationClient()],
} satisfies Parameters<typeof createAuthClient>[0]

export const authClient = createAuthClient(authClientOptions)
```

- [ ] **Step 4: Write failing server auth tests**

Create `src/server/__tests__/auth.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"

import { createAuthBridge, toAuthSession } from "../auth"
import type { AppConfig } from "../types"

const config: AppConfig = {
  email: {
    provider: "log",
    appName: "LinearDesk",
    from: "LinearDesk <noreply@lineardesk.local>",
  },
  databaseUrl: "postgres://lineardesk:lineardesk@localhost:5432/lineardesk",
  betterAuthSecret: "test-secret",
  betterAuthUrl: "http://localhost:3000",
  googleClientId: "google-id",
  googleClientSecret: "google-secret",
  linear: {
    apiKey: "lin_api_key",
    teamId: "team-id",
    teamKey: "BAS",
    initialStateName: "Triage",
    labelName: "Bug",
    webhookSecret: "webhook-secret",
  },
}

describe("toAuthSession", () => {
  it("maps active organization and session token", () => {
    expect(
      toAuthSession({
        user: { id: "u1", email: "ada@example.com", name: "Ada" },
        session: { token: "token-1", activeOrganizationId: "org-1" },
      })
    ).toEqual({
      user: { id: "u1", email: "ada@example.com", name: "Ada" },
      activeOrganizationId: "org-1",
      sessionToken: "token-1",
    })
  })
})

describe("createAuthBridge", () => {
  it("does not send magic-link email for an unapproved domain", async () => {
    const orgAccess = {
      findActiveOrganizationForEmail: vi.fn(async () => null),
    }
    const emailSender = {
      sendMagicLink: vi.fn(),
      sendInvitation: vi.fn(),
    }
    const bridge = createAuthBridge(config, {
      orgAccess: orgAccess as never,
      emailSender,
    })

    await bridge.sendMagicLinkForTest?.("ada@evil.test", "https://desk/magic")

    expect(orgAccess.findActiveOrganizationForEmail).toHaveBeenCalledWith(
      "ada@evil.test"
    )
    expect(emailSender.sendMagicLink).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 5: Run server auth tests and verify they fail**

Run:

```bash
bun run test src/server/__tests__/auth.test.ts
```

Expected: FAIL because `toAuthSession` is not exported, `createAuthBridge` does not accept injectable dependencies, and the test-only helper does not exist.

- [ ] **Step 6: Implement Better Auth plugins in `src/server/auth.ts`**

Modify imports:

```ts
import { betterAuth } from "better-auth"
import { magicLink, organization } from "better-auth/plugins"
import { Pool } from "pg"

import { createEmailSender, type EmailSender } from "./email"
import { createOrgAccessRepository } from "./org-access"
import type { AppConfig, AuthBridge, AuthSession, OrgAccessRepository } from "./types"
```

Add an options type:

```ts
type CreateAuthBridgeOptions = {
  orgAccess?: Pick<OrgAccessRepository, "findActiveOrganizationForEmail">
  emailSender?: EmailSender
}
```

Replace `createAuthBridge` signature and setup:

```ts
export function createAuthBridge(
  config: AppConfig,
  options: CreateAuthBridgeOptions = {}
): AuthBridge {
  const orgAccess = options.orgAccess ?? createOrgAccessRepository()
  const emailSender = options.emailSender ?? createEmailSender(config.email)
  const sendMagicLink = async (email: string, url: string) => {
    const organization = await orgAccess.findActiveOrganizationForEmail(email)
    if (!organization) return

    await emailSender.sendMagicLink({
      to: email,
      url,
      expiresInMinutes: 5,
    })
  }

  const auth = betterAuth({
    database: new Pool(pgPoolConfig(config.databaseUrl)),
    secret: config.betterAuthSecret,
    baseURL: config.betterAuthUrl,
    socialProviders: {
      google: {
        clientId: config.googleClientId,
        clientSecret: config.googleClientSecret,
      },
    },
    plugins: [
      organization({
        allowUserToCreateOrganization: false,
        requireEmailVerificationOnInvitation: true,
        sendInvitationEmail: async (data) => {
          const inviteUrl = new URL("/login", config.betterAuthUrl)
          inviteUrl.searchParams.set("invitationId", data.id)
          await emailSender.sendInvitation({
            to: data.email,
            inviteUrl: inviteUrl.toString(),
            organizationName: data.organization.name,
            inviterEmail: data.inviter.user.email,
            role: data.role,
            expiresInDays: 2,
          })
        },
      }),
      magicLink({
        expiresIn: 60 * 5,
        storeToken: "hashed",
        sendMagicLink: async ({ email, url }) => {
          await sendMagicLink(email, url)
        },
      }),
    ],
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            const organization =
              await orgAccess.findActiveOrganizationForEmail(user.email)
            if (!organization) throw new Error("Email domain is not allowed")

            return { data: user }
          },
        },
      },
    },
  })

  return {
    handler: (request) => auth.handler(request),
    getSession: async (headers) => {
      const session = await auth.api.getSession({ headers })
      return toAuthSession(session)
    },
    sendMagicLinkForTest:
      process.env.NODE_ENV === "test" ? sendMagicLink : undefined,
  }
}
```

Export and replace `toAuthSession`:

```ts
export function toAuthSession(value: unknown): AuthSession | null {
  if (!value || typeof value !== "object") return null

  const authValue = value as {
    user?: {
      id?: unknown
      email?: unknown
      name?: unknown
    }
    session?: {
      token?: unknown
      activeOrganizationId?: unknown
    }
  }

  if (
    typeof authValue.user?.id !== "string" ||
    typeof authValue.user.email !== "string"
  ) {
    return null
  }

  return {
    user: {
      id: authValue.user.id,
      email: authValue.user.email,
      name:
        typeof authValue.user.name === "string" ? authValue.user.name : null,
    },
    activeOrganizationId:
      typeof authValue.session?.activeOrganizationId === "string"
        ? authValue.session.activeOrganizationId
        : null,
    sessionToken:
      typeof authValue.session?.token === "string"
        ? authValue.session.token
        : null,
  }
}
```

Update `AuthBridge` in `src/server/types.ts`:

```ts
export type AuthBridge = {
  handler?: (request: Request) => Promise<Response> | Response
  getSession: (headers: Headers) => Promise<AuthSession | null>
  sendMagicLinkForTest?: (email: string, url: string) => Promise<void>
}
```

- [ ] **Step 7: Run task tests**

Run:

```bash
bun run test src/lib/__tests__/auth-client.test.ts src/server/__tests__/auth.test.ts
```

Expected: PASS because `src/server/org-access.ts` was created in Task 3.

- [ ] **Step 8: Commit**

```bash
git add src/server/auth.ts src/lib/auth-client.ts src/lib/__tests__/auth-client.test.ts src/server/types.ts src/server/__tests__/auth.test.ts
git commit -m "feat: enable Better Auth org and magic-link plugins"
```

---

### Task 5: Org-Scoped Request Repository and API Authorization

**Files:**
- Modify: `src/server/types.ts`
- Modify: `src/server/repository.ts`
- Modify: `src/server/app.ts`
- Modify: `src/server/__tests__/app.test.ts`
- Modify: `src/server/__tests__/repository-shape.test.ts`

- [ ] **Step 1: Write failing API tests for org scoping**

In `src/server/__tests__/app.test.ts`, update `makeRecord` to include `organizationId: "org-1"` and update `makeRepo` method names:

```ts
listRequestsForOrganization: vi.fn(async () => [makeRecord()]),
getRequestForOrganization: vi.fn(async () => makeRecord()),
```

Update the `config` fixture in `src/server/__tests__/app.test.ts` by removing:

```ts
allowedEmailDomains: ["example.com"],
```

and adding:

```ts
email: {
  provider: "log",
  appName: "LinearDesk",
  from: "LinearDesk <noreply@lineardesk.local>",
},
```

Add an `orgAccess` factory:

```ts
function makeOrgAccess() {
  return {
    findActiveOrganizationForEmail: vi.fn(async () => ({
      organizationId: "org-1",
      organizationName: "Example",
      organizationSlug: "example",
      domain: "example.com",
    })),
    ensureMember: vi.fn(async () => undefined),
    listMembershipsForUser: vi.fn(async () => []),
    hasMembership: vi.fn(async () => true),
    setActiveOrganizationForSession: vi.fn(async () => undefined),
  }
}
```

Every `createApiApp` test dependency object must include `orgAccess: makeOrgAccess()`.
Also update `src/server/__tests__/reconcile.test.ts` and any other `HelpdeskRepository` test double to implement `listRequestsForOrganization` and `getRequestForOrganization` instead of the removed email-scoped methods.

Replace the old forbidden-domain test with:

```ts
it("rejects authenticated users outside any approved organization", async () => {
  const app = createApiApp({
    config,
    repo: makeRepo(),
    linear: makeLinear(),
    auth: { getSession: vi.fn(async () => session) },
    orgAccess: {
      ...makeOrgAccess(),
      findActiveOrganizationForEmail: vi.fn(async () => null),
      hasMembership: vi.fn(async () => false),
    },
  })

  const response = await app.fetch(new Request("http://localhost/api/requests"))

  expect(response.status).toBe(403)
  await expect(response.json()).resolves.toEqual({ error: "forbidden_org" })
})
```

Add:

```ts
it("lists requests for the resolved organization", async () => {
  const repo = makeRepo()
  const app = createApiApp({
    config,
    repo,
    linear: makeLinear(),
    auth: { getSession: vi.fn(async () => session) },
    orgAccess: makeOrgAccess(),
  })

  const response = await app.fetch(new Request("http://localhost/api/requests"))

  expect(response.status).toBe(200)
  expect(repo.listRequestsForOrganization).toHaveBeenCalledWith("org-1")
})
```

In the existing create-request test, assert:

```ts
expect(repo.createRequest).toHaveBeenCalledWith(
  expect.objectContaining({
    requesterUserId: "user-id",
    requesterEmail: "person@example.com",
    organizationId: "org-1",
  })
)
```

- [ ] **Step 2: Run API tests and verify they fail**

Run:

```bash
bun run test src/server/__tests__/app.test.ts
```

Expected: FAIL because API dependencies and repository methods are still email-scoped.

- [ ] **Step 3: Update repository interface**

In `src/server/types.ts`, replace repository methods:

```ts
listRequestsForOrganization: (
  organizationId: string
) => Promise<RequestRecord[]>
getRequestForOrganization: (
  id: string,
  organizationId: string
) => Promise<RequestRecord | null>
```

Remove `listRequestsForEmail` and `getRequestForEmail` from `HelpdeskRepository`.

- [ ] **Step 4: Implement org-scoped repository methods**

In `src/server/repository.ts`, replace `listRequestsForEmail` with:

```ts
async listRequestsForOrganization(
  organizationId: string
): Promise<RequestRecord[]> {
  const rows = await this.db
    .select()
    .from(helpdeskRequests)
    .where(eq(helpdeskRequests.organizationId, organizationId))
    .orderBy(desc(helpdeskRequests.createdAt))
  return rows.map(toRequestRecord)
}
```

Replace `getRequestForEmail` with:

```ts
async getRequestForOrganization(
  id: string,
  organizationId: string
): Promise<RequestRecord | null> {
  const rows = await this.db
    .select()
    .from(helpdeskRequests)
    .where(
      and(
        eq(helpdeskRequests.id, id),
        eq(helpdeskRequests.organizationId, organizationId)
      )
    )
    .limit(1)
  const row = rows[0] as HelpdeskRequestRow | undefined
  return row ? toRequestRecord(row) : null
}
```

- [ ] **Step 5: Update API dependencies and authorization**

In `src/server/app.ts`, import:

```ts
import {
  createOrgAccessRepository,
  resolvePortalOrganization,
} from "./org-access"
```

Add `OrgAccessRepository` to the existing type import from `./types`.

Add to `ApiDependencies`:

```ts
orgAccess: OrgAccessRepository
```

Add default dependency:

```ts
orgAccess: createOrgAccessRepository(),
```

Create local type:

```ts
type AuthorizedPortalSession = AuthSession & { organizationId: string }
```

Replace `requireAuthorizedSession` with:

```ts
async function requireAuthorizedSession(
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
```

Then replace all API calls:

```ts
repo.listRequestsForOrganization(session.organizationId)
repo.getRequestForOrganization(params.id, session.organizationId)
```

In web request creation, add:

```ts
organizationId: session.organizationId,
```

- [ ] **Step 6: Update app tests for new dependency**

In every `createApiApp({ ... })` fixture in `src/server/__tests__/app.test.ts`, add:

```ts
orgAccess: makeOrgAccess(),
```

If a test intentionally checks unauthenticated behavior, the orgAccess mock is still required but should not be called.

- [ ] **Step 7: Run API tests**

Run:

```bash
bun run test src/server/__tests__/app.test.ts src/server/__tests__/repository-shape.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/server/types.ts src/server/repository.ts src/server/app.ts src/server/__tests__/app.test.ts src/server/__tests__/repository-shape.test.ts
git commit -m "feat: scope request APIs by organization"
```

---

### Task 6: Slack Tickets Resolve and Persist Organization

**Files:**
- Modify: `src/server/slack/ticket.ts`
- Modify: `src/server/__tests__/slack-ticket.test.ts`
- Modify: `src/server/app.ts`
- Modify: `src/server/__tests__/slack-routes.test.ts`

- [ ] **Step 1: Write failing Slack ticket tests**

In `src/server/__tests__/slack-ticket.test.ts`, update the deps factory to include `orgAccess`:

```ts
orgAccess: {
  findActiveOrganizationForEmail: vi.fn(async () =>
    email
      ? {
          organizationId: "org-1",
          organizationName: "Example",
          organizationSlug: "example",
          domain: "meiro.io",
        }
      : null
  ),
},
```

Add a test:

```ts
it("rejects when the slack email domain is not approved", async () => {
  const d = deps("dev@evil.test")
  d.orgAccess.findActiveOrganizationForEmail = vi.fn(async () => null)

  await expect(
    createSlackTicket(d as unknown as SlackTicketDeps, {
      slackUserId: "U1",
      title: "T",
      description: "D",
      severity: 2,
      channel: "C1",
      threadTs: "1.2",
      files: [],
    })
  ).rejects.toMatchObject({ name: "SlackEmailDomainNotAllowedError" })
})
```

In the create test, assert:

```ts
expect(d.repo.createRequest).toHaveBeenCalledWith(
  expect.objectContaining({
    organizationId: "org-1",
  })
)
```

- [ ] **Step 2: Run Slack ticket tests and verify they fail**

Run:

```bash
bun run test src/server/__tests__/slack-ticket.test.ts
```

Expected: FAIL because `createSlackTicket` does not resolve organizations.

- [ ] **Step 3: Implement Slack domain rejection and org persistence**

In `src/server/slack/ticket.ts`, import `OrgAccessRepository` and add:

```ts
export class SlackEmailDomainNotAllowedError extends Error {
  constructor() {
    super("Slack email domain is not approved")
    this.name = "SlackEmailDomainNotAllowedError"
  }
}
```

Update deps:

```ts
orgAccess: Pick<OrgAccessRepository, "findActiveOrganizationForEmail">
```

After resolving email:

```ts
const organization = await deps.orgAccess.findActiveOrganizationForEmail(email)
if (!organization) throw new SlackEmailDomainNotAllowedError()
```

In `repo.createRequest`, add:

```ts
organizationId: organization.organizationId,
```

- [ ] **Step 4: Update Slack route error handling**

In `src/server/app.ts`, import `SlackEmailDomainNotAllowedError`. In Slack creation error handling, return a clear message:

```ts
const reason =
  error instanceof SlackEmailMissingError
    ? "your Slack account has no email"
    : error instanceof SlackEmailDomainNotAllowedError
      ? "your email domain is not approved for LinearDesk"
      : error instanceof Error
        ? error.message
        : "unknown error"
```

Ensure every `createSlackTicket` call receives:

```ts
orgAccess: deps.orgAccess,
```

- [ ] **Step 5: Update Slack route tests**

In `src/server/__tests__/slack-routes.test.ts`, update the `config` fixture by removing `allowedEmailDomains` and adding the same `email` block used in `app.test.ts`. Update `makeRecord` with `organizationId: "org-1"` and update `makeRepo` to use `listRequestsForOrganization` / `getRequestForOrganization`.

Add `orgAccess: makeOrgAccess()` to every `createApiApp` dependency object. Add a test for unmapped Slack domain in the `view_submission` or mention path:

```ts
it("reports unmapped Slack email domains", async () => {
  const orgAccess = {
    ...makeOrgAccess(),
    findActiveOrganizationForEmail: vi.fn(async () => null),
  }
  const app = createApiApp({
    config: slackConfig,
    repo: makeRepo(),
    linear: makeLinear(),
    auth: { getSession: vi.fn(async () => null) },
    slack: makeSlack({ email: "dev@evil.test" }),
    orgAccess,
  })

  // Reuse the existing signed view_submission helper in this test file.
  const response = await app.fetch(signedSlackRequest(viewSubmissionPayload()))

  expect(response.status).toBe(200)
  expect(orgAccess.findActiveOrganizationForEmail).toHaveBeenCalledWith(
    "dev@evil.test"
  )
})
```

Use the existing helper names in `slack-routes.test.ts`; do not introduce a second Slack signing helper if one already exists in that file.

- [ ] **Step 6: Run Slack tests**

Run:

```bash
bun run test src/server/__tests__/slack-ticket.test.ts src/server/__tests__/slack-routes.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/server/slack/ticket.ts src/server/__tests__/slack-ticket.test.ts src/server/app.ts src/server/__tests__/slack-routes.test.ts
git commit -m "feat: attach Slack tickets to customer organizations"
```

---

### Task 7: Portal Route Auth State and Login UI

**Files:**
- Modify: `src/server/route-auth.ts`
- Modify: `src/lib/route-guards.ts`
- Modify: `src/routes/login.tsx`
- Modify: `src/routes/index.tsx`
- Modify: `src/routeTree.gen.ts` if TanStack generation changes it

Before executing this task, load the `modern-web-guidance` skill because this task edits client-side React UI.

- [ ] **Step 1: Update route auth state**

In `src/server/route-auth.ts`, import org access:

```ts
import {
  createOrgAccessRepository,
  resolvePortalOrganization,
} from "./org-access"
```

Change the handler result to:

```ts
const session = await getAuthBridge(config).getSession(headers)
if (!session) return { authenticated: false, reason: "unauthorized" as const }

const resolution = await resolvePortalOrganization(
  session,
  createOrgAccessRepository()
)

if (resolution.status !== "ok") {
  return { authenticated: false, reason: resolution.status }
}

return {
  authenticated: true,
  organizationId: resolution.organizationId,
}
```

Remove `isAllowedEmail` and `allowedEmailDomains` from the cache key.

- [ ] **Step 2: Update route guard**

In `src/lib/route-guards.ts`, redirect blocked users to login with a reason:

```ts
export async function requirePortalAuth() {
  const auth = await getPortalAuthState()
  if (!auth.authenticated) {
    throw redirect({
      to: "/login",
      search: auth.reason ? { reason: auth.reason } : undefined,
    })
  }
}
```

- [ ] **Step 3: Implement magic-link login UI**

In `src/routes/login.tsx`, add search validation and state:

```ts
export const Route = createFileRoute("/login")({
  validateSearch: (search) => ({
    reason:
      typeof search.reason === "string" ? search.reason : undefined,
    invitationId:
      typeof search.invitationId === "string" ? search.invitationId : undefined,
  }),
  component: Login,
})
```

Inside `Login`, add:

```ts
const { reason } = Route.useSearch()
const [email, setEmail] = useState("")
const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">(
  "idle"
)
```

Add an email form below the Google button:

```tsx
<form
  className="flex flex-col gap-3"
  onSubmit={(event) => {
    event.preventDefault()
    setStatus("sending")
    void authClient.signIn
      .magicLink({
        email,
        callbackURL: "/",
        errorCallbackURL: "/login",
      })
      .then(() => setStatus("sent"))
      .catch(() => setStatus("error"))
  }}
>
  <div className="flex flex-col gap-2">
    <Label htmlFor="email">Work email</Label>
    <Input
      id="email"
      type="email"
      autoComplete="email"
      value={email}
      onChange={(event) => setEmail(event.target.value)}
      required
    />
  </div>
  <Button type="submit" variant="secondary" disabled={status === "sending"}>
    {status === "sending" ? "Sending link..." : "Email me a sign-in link"}
  </Button>
  {status === "sent" ? (
    <p className="text-sm text-muted-foreground">
      If this email is approved, a sign-in link is on its way.
    </p>
  ) : null}
  {status === "error" ? (
    <p className="text-sm text-destructive">
      The sign-in link could not be sent. Try again in a moment.
    </p>
  ) : null}
</form>
```

Add a blocked-state message near the top of the card:

```tsx
{reason === "multiple_organizations" ? (
  <Alert>
    <AlertTitle>Choose an organization</AlertTitle>
    <AlertDescription>
      Your account belongs to more than one organization. Organization
      switching is not enabled for this portal yet.
    </AlertDescription>
  </Alert>
) : reason === "forbidden" ? (
  <Alert variant="destructive">
    <AlertTitle>Access not approved</AlertTitle>
    <AlertDescription>
      This email is not approved for LinearDesk portal access.
    </AlertDescription>
  </Alert>
) : null}
```

Add imports:

```ts
import { useState } from "react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
```

- [ ] **Step 4: Update dashboard copy**

In `src/routes/index.tsx`, change the `PageShell` description from:

```tsx
description="Track the current Linear status for requests you submitted."
```

to:

```tsx
description="Track the current Linear status for your organization's requests."
```

- [ ] **Step 5: Regenerate route tree if needed**

Run:

```bash
bun run typecheck
```

If TanStack reports route search type errors or modifies `src/routeTree.gen.ts` during dev/build, run the repo's route generation path through:

```bash
bun run build
```

Expected: type errors point only to login search typing until fixed. Include `src/routeTree.gen.ts` in this task's commit only if the tooling changes it.

- [ ] **Step 6: Run focused checks**

Run:

```bash
bun run typecheck
bun run test src/lib/__tests__/auth-client.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/server/route-auth.ts src/lib/route-guards.ts src/routes/login.tsx src/routes/index.tsx src/routeTree.gen.ts
git commit -m "feat: add magic-link login UI"
```

If `src/routeTree.gen.ts` was not modified, omit it from `git add`.

---

### Task 8: Customer Organization Seed and Backfill Script

**Files:**
- Create: `scripts/seed-customer-org.ts`
- Modify: `package.json`

- [ ] **Step 1: Add seed script**

Create `scripts/seed-customer-org.ts`:

```ts
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
  if (row.organizationId) continue
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
```

The final script must pass `bun run typecheck`.

- [ ] **Step 2: Add package script**

In `package.json`, add:

```json
"org:seed": "bun run scripts/seed-customer-org.ts"
```

Place it near the existing `db:*` scripts.

- [ ] **Step 3: Run typecheck**

Run:

```bash
bun run typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add scripts/seed-customer-org.ts package.json
git commit -m "feat: add customer org seed script"
```

---

### Task 9: Environment and Documentation

**Files:**
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `docs/USER_GUIDE.md`

- [ ] **Step 1: Read current user changes**

Before editing docs, run:

```bash
git status --short
git diff -- README.md
sed -n '1,240p' docs/USER_GUIDE.md
```

Expected: `README.md` may contain user changes and `docs/USER_GUIDE.md` may be untracked. Preserve their content while adding the new auth/org docs.

- [ ] **Step 2: Update `.env.example`**

Remove:

```dotenv
ALLOWED_EMAIL_DOMAINS=
```

Add:

```dotenv
# Transactional email. Local dev defaults to EMAIL_PROVIDER=log.
EMAIL_PROVIDER=log
EMAIL_FROM="LinearDesk <noreply@lineardesk.local>"
EMAIL_APP_NAME=LinearDesk
# Required when EMAIL_PROVIDER=resend, or when RESEND_API_KEY should imply Resend.
RESEND_API_KEY=
```

- [ ] **Step 3: Update README environment contract**

In `README.md`, replace `ALLOWED_EMAIL_DOMAINS` with:

```md
- `EMAIL_PROVIDER` — `log` for local development or `resend` for production email.
- `EMAIL_FROM`
- `EMAIL_APP_NAME`
- `RESEND_API_KEY` — required when `EMAIL_PROVIDER=resend`; used for magic links and organization invitations.
```

Add an operator section:

```md
### Customer organizations

Customer access is organization-scoped. A user who signs in with a verified
email on an approved domain becomes a member of the matching Better Auth
organization and can see that organization's tickets.

Seed a customer organization and its domains before inviting users:

```bash
CUSTOMER_ORG_NAME='Acme Corp' \
CUSTOMER_ORG_SLUG='acme' \
CUSTOMER_EMAIL_DOMAINS='acme.com,acme.io' \
bun run org:seed
```

The seed command also backfills existing tickets whose `requester_email` domain
matches the seeded domains. It prints any remaining unmapped requester emails;
map those before enforcing `helpdesk_requests.organization_id` as not null.
```

Add deployment note:

```md
Production deployments need a transactional email provider. LinearDesk uses
Resend through an internal adapter; no SMTP server is required.
```

- [ ] **Step 4: Update user guide**

In `docs/USER_GUIDE.md`, update the portal sign-in section to say:

```md
- **Web portal** — sign in with Google or request a magic link for your approved work email.
```

Add a note near tracking requests:

```md
Your request list is shared across your customer organization. Other approved
users from the same organization can see tickets filed under your company's
approved domains, and you can see theirs.
```

- [ ] **Step 5: Run docs formatting check**

Run:

```bash
bun run check
```

Expected: PASS, or only existing unrelated formatting failures. If formatting fails on edited files, run:

```bash
bun run format README.md docs/USER_GUIDE.md .env.example
```

- [ ] **Step 6: Commit**

```bash
git add .env.example README.md docs/USER_GUIDE.md
git commit -m "docs: document customer organization access"
```

---

### Task 10: Final Verification and Rollout Check

**Files:**
- No planned source edits unless verification finds issues.

- [ ] **Step 1: Run full test suite**

Run:

```bash
bun run test
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```bash
bun run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run lint**

Run:

```bash
bun run lint
```

Expected: PASS.

- [ ] **Step 4: Run build**

Run:

```bash
bun run build
```

Expected: PASS.

- [ ] **Step 5: Verify generated migration is present**

Run:

```bash
ls drizzle | sort | tail
rg -n "organization_email_domains|activeOrganizationId|organization_id" drizzle
```

Expected: the latest migration and snapshot include organization tables, `session.activeOrganizationId`, and `helpdesk_requests.organization_id`.

- [ ] **Step 6: Manual local smoke path**

Run:

```bash
docker compose up -d db
bun run db:migrate
CUSTOMER_ORG_NAME='Example Inc' CUSTOMER_ORG_SLUG='example' CUSTOMER_EMAIL_DOMAINS='example.com' bun run org:seed
bun run dev
```

Expected:

- `bun run org:seed` prints an `organizationId`.
- The app starts on `http://localhost:3000`.
- Requesting a magic link in local mode logs the link to the server console.
- Following the logged link signs the user in.
- The request list loads without a forbidden-org error.

- [ ] **Step 7: Commit verification fixes if any**

If verification required code changes:

```bash
git add <changed-files>
git commit -m "fix: stabilize customer organization access"
```

If no fixes were needed, do not create an empty commit.

## Spec Coverage Review

- Magic link login: Tasks 1, 4, 7, 9.
- Better Auth organization plugin: Tasks 2, 3, 4.
- Custom one-to-many org-domain mapping: Tasks 2, 3, 8.
- Domain auto-enrollment: Tasks 3, 4, 5, 7.
- Tickets scoped by organization: Tasks 2, 5, 6.
- Slack ticket org resolution: Task 6.
- Public-domain rejection: Task 3 and Task 8.
- Existing ticket backfill: Task 8 and Task 10.
- Docs and env contract: Task 9.
- Verification: Task 10.
