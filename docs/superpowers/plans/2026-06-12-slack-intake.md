# Slack Intake (Plan A — creation path) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a Slack user turn a message (often with a screenshot) into a LinearDesk ticket via a `/ticket` command or a message shortcut, attributed by their Slack email, visible in the web portal.

**Architecture:** A new, optional Slack surface on the existing Elysia API. A message shortcut or slash command opens a Block Kit modal; on submit we resolve the requester by email, reuse the existing `createHelpdeskIssue` + `createRequest` path, upload any attached images to Linear via the existing `uploadAsset`, and post a confirmation back to the Slack thread. Slack is feature-gated: no `SLACK_*` env → routes don't mount. Updates flowing *back* to Slack are **Plan B** (depends on the `attachmentLinkSlack` spike).

**Tech Stack:** TypeScript, Elysia, Drizzle (Postgres), Better Auth, Linear SDK, Slack Web API (raw `fetch`), Vitest.

**Scope boundary (Plan A):** intake + creation + image upload + portal visibility + feature gating + docs. **Out:** posting Linear updates/comments back to Slack, the `attachmentLinkSlack` link, inbound reply sync — all Plan B.

---

## File structure

**Create**
- `src/server/slack/signature.ts` — verify Slack request signatures.
- `src/server/slack/gateway.ts` — thin Slack Web API adapter (`SlackGateway`).
- `src/server/slack/modal.ts` — pure Block Kit modal builder + view-submission parsing.
- `src/server/slack/ticket.ts` — `createSlackTicket` service (resolve requester, upload images, create issue+record).
- `src/server/__tests__/slack-signature.test.ts`
- `src/server/__tests__/slack-modal.test.ts`
- `src/server/__tests__/slack-ticket.test.ts`
- `src/server/__tests__/slack-routes.test.ts`
- `scripts/send-test-slack.ts` — local signed-request helper.
- `docs/slack-app-manifest.md` — committed reference manifest.

**Modify**
- `src/server/types.ts` — `AppConfig.slack?`, `SlackGateway`, `SlackFileRef`, `RequestRecord`/`CreateRequestRecordInput` (nullable `requesterUserId`, `source`, slack fields), repo method signatures.
- `src/server/config.ts` — read optional `SLACK_SIGNING_SECRET` / `SLACK_BOT_TOKEN`.
- `src/server/db/schema.ts` — nullable `requester_user_id`; add `source`, `slack_channel_id`, `slack_message_ts`.
- `src/server/repository.ts` — `getUserIdByEmail`, email-keyed list/get, `createRequest` new fields.
- `src/server/request-validation.ts` — export `severityFromLabel`, add `parseSlackTicketInput`.
- `src/server/linear.ts` — export `composeRequesterDescription` helper (reuse the `Requester:` prefix logic) — optional, see Task 7.
- `src/server/app.ts` — pass `session.user.email` to repo; add `slack?` dependency; mount `/api/slack/*` when configured; add `source` to `serializeRequest`.
- `src/lib/helpdesk-api.ts` — add `source` to `PortalRequest`.
- `.env.example`, `README.md` — Slack env + setup.

---

## Task 1: Schema migration — nullable requester, source + slack columns

**Files:**
- Modify: `src/server/db/schema.ts:94-133`
- Generate: `drizzle/` migration

- [ ] **Step 1: Edit the schema**

In `src/server/db/schema.ts`, change `requesterUserId` to nullable and add three columns inside the `helpdeskRequests` table definition:

```ts
    // was: .notNull()
    requesterUserId: text("requester_user_id"),
    requesterEmail: text("requester_email").notNull(),
    // ...existing columns unchanged...
    source: text("source").notNull().default("web"),
    slackChannelId: text("slack_channel_id"),
    slackMessageTs: text("slack_message_ts"),
```

Keep the existing `requester_user_id` index.

- [ ] **Step 2: Generate the migration**

Run: `bun run db:generate`
Expected: a new file under `drizzle/` containing `ALTER TABLE "helpdesk_requests" ALTER COLUMN "requester_user_id" DROP NOT NULL`, plus `ADD COLUMN "source" ... DEFAULT 'web'`, `ADD COLUMN "slack_channel_id"`, `ADD COLUMN "slack_message_ts"`.

- [ ] **Step 3: Review the generated SQL**

Open the new `drizzle/*.sql` file and confirm it only alters `helpdesk_requests` as above — no destructive drops.

- [ ] **Step 4: Apply locally (CAUTION)**

> `.env.local`'s `DATABASE_URL` currently points at **prod Neon**. Do NOT migrate prod here. Apply against the local docker DB by overriding the URL for this one command:

Run: `DATABASE_URL='postgres://lineardesk:lineardesk@localhost:5433/lineardesk' bun run db:migrate`
Expected: migration applies; no errors.

- [ ] **Step 5: Commit**

```bash
git add src/server/db/schema.ts drizzle/
git commit -m "feat(slack): schema for slack-sourced requests"
```

---

## Task 2: Types — config, gateway, record shape

**Files:**
- Modify: `src/server/types.ts`

- [ ] **Step 1: Extend `AppConfig`**

Add to the `AppConfig` type (after `linear: {...}`):

```ts
  slack?: {
    signingSecret: string
    botToken: string
  }
```

- [ ] **Step 2: Add Slack gateway + file types**

Append to `src/server/types.ts`:

```ts
export type SlackFileRef = {
  id: string
  name: string
  mimetype: string
  urlPrivate: string
}

export type SlackGateway = {
  openView: (triggerId: string, view: unknown) => Promise<void>
  postMessage: (input: {
    channel: string
    threadTs?: string
    text: string
  }) => Promise<{ channel: string; ts: string }>
  getUserEmail: (userId: string) => Promise<string | null>
  downloadFile: (
    urlPrivate: string
  ) => Promise<{ bytes: Uint8Array; contentType: string }>
}
```

- [ ] **Step 3: Make the record shape Slack-aware**

In `RequestRecord`, change `requesterUserId: string` to `requesterUserId: string | null` and add:

```ts
  source: "web" | "slack"
  slackChannelId: string | null
  slackMessageTs: string | null
```

In `CreateRequestRecordInput`, change `requesterUserId: string` to `requesterUserId: string | null` and add:

```ts
  source?: "web" | "slack"
  slackChannelId?: string | null
  slackMessageTs?: string | null
```

- [ ] **Step 4: Update repo signatures**

In `HelpdeskRepository`, replace the two user-keyed methods and add a lookup:

```ts
  createRequest: (input: CreateRequestRecordInput) => Promise<RequestRecord>
  getUserIdByEmail: (email: string) => Promise<string | null>
  listRequestsForEmail: (email: string) => Promise<RequestRecord[]>
  getRequestForEmail: (
    id: string,
    email: string
  ) => Promise<RequestRecord | null>
```

(Remove `listRequestsForUser` and `getRequestForUser`.)

- [ ] **Step 5: Verify it compiles (expected to fail elsewhere)**

Run: `bun run typecheck`
Expected: errors in `repository.ts`, `app.ts`, `app.test.ts` (fixed in later tasks). `types.ts` itself has no errors.

- [ ] **Step 6: Commit**

```bash
git add src/server/types.ts
git commit -m "feat(slack): types for slack config, gateway, and record source"
```

---

## Task 3: Config — read optional Slack env

**Files:**
- Modify: `src/server/config.ts:40-61`
- Test: `src/server/__tests__/config.test.ts` (create if absent)

- [ ] **Step 1: Write the failing test**

Create/append `src/server/__tests__/config.test.ts`:

```ts
import { describe, expect, it } from "vitest"

import { readAppConfig } from "../config"

const base = {
  ALLOWED_EMAIL_DOMAINS: "example.com",
  DATABASE_URL: "postgres://x@localhost:5432/x",
  BETTER_AUTH_SECRET: "s",
  BETTER_AUTH_URL: "http://localhost:3000",
  GOOGLE_CLIENT_ID: "g",
  GOOGLE_CLIENT_SECRET: "gs",
  LINEAR_API_KEY: "lin",
  LINEAR_WEBHOOK_SECRET: "wh",
}

describe("readAppConfig slack", () => {
  it("omits slack when env is absent", () => {
    expect(readAppConfig(base).slack).toBeUndefined()
  })

  it("includes slack when both vars are present", () => {
    const config = readAppConfig({
      ...base,
      SLACK_SIGNING_SECRET: "sign",
      SLACK_BOT_TOKEN: "xoxb-1",
    })
    expect(config.slack).toEqual({ signingSecret: "sign", botToken: "xoxb-1" })
  })
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `bun run test -- slack`
Expected: FAIL — `slack` is undefined in the second case.

- [ ] **Step 3: Implement**

In `readAppConfig`, before `return {`:

```ts
  const slackSigningSecret = env.SLACK_SIGNING_SECRET?.trim()
  const slackBotToken = env.SLACK_BOT_TOKEN?.trim()
  const slack =
    slackSigningSecret && slackBotToken
      ? { signingSecret: slackSigningSecret, botToken: slackBotToken }
      : undefined
```

Add `slack,` as the last property of the returned object.

- [ ] **Step 4: Run the test**

Run: `bun run test -- slack`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/config.ts src/server/__tests__/config.test.ts
git commit -m "feat(slack): read optional slack env into config"
```

---

## Task 4: Slack request-signature verification

**Files:**
- Create: `src/server/slack/signature.ts`
- Test: `src/server/__tests__/slack-signature.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { createHmac } from "node:crypto"

import { describe, expect, it } from "vitest"

import { verifySlackSignature } from "../slack/signature"

function sign(secret: string, ts: string, body: string) {
  const hmac = createHmac("sha256", secret).update(`v0:${ts}:${body}`)
  return `v0=${hmac.digest("hex")}`
}

const secret = "shhh"
const body = "token=x&command=%2Fticket"
const now = 1_900_000_000_000 // fixed "now" in ms

describe("verifySlackSignature", () => {
  it("accepts a valid, fresh signature", () => {
    const ts = String(Math.floor(now / 1000))
    expect(
      verifySlackSignature({
        signingSecret: secret,
        signature: sign(secret, ts, body),
        timestamp: ts,
        rawBody: body,
        nowMs: now,
      })
    ).toBe(true)
  })

  it("rejects a tampered body", () => {
    const ts = String(Math.floor(now / 1000))
    expect(
      verifySlackSignature({
        signingSecret: secret,
        signature: sign(secret, ts, body),
        timestamp: ts,
        rawBody: body + "&evil=1",
        nowMs: now,
      })
    ).toBe(false)
  })

  it("rejects a stale timestamp (> 5 min)", () => {
    const ts = String(Math.floor(now / 1000) - 600)
    expect(
      verifySlackSignature({
        signingSecret: secret,
        signature: sign(secret, ts, body),
        timestamp: ts,
        rawBody: body,
        nowMs: now,
      })
    ).toBe(false)
  })
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `bun run test -- slack-signature`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import { createHmac, timingSafeEqual } from "node:crypto"

const FIVE_MINUTES_MS = 5 * 60 * 1000

export function verifySlackSignature(input: {
  signingSecret: string
  signature: string | null
  timestamp: string | null
  rawBody: string
  nowMs: number
}): boolean {
  if (!input.signature || !input.timestamp) return false

  const tsSeconds = Number.parseInt(input.timestamp, 10)
  if (!Number.isFinite(tsSeconds)) return false
  if (Math.abs(input.nowMs - tsSeconds * 1000) > FIVE_MINUTES_MS) return false

  const expected = `v0=${createHmac("sha256", input.signingSecret)
    .update(`v0:${input.timestamp}:${input.rawBody}`)
    .digest("hex")}`

  const a = Buffer.from(expected)
  const b = Buffer.from(input.signature)
  return a.length === b.length && timingSafeEqual(a, b)
}
```

- [ ] **Step 4: Run the test**

Run: `bun run test -- slack-signature`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/slack/signature.ts src/server/__tests__/slack-signature.test.ts
git commit -m "feat(slack): request signature verification"
```

---

## Task 5: Severity mapping + Slack ticket input validation

**Files:**
- Modify: `src/server/request-validation.ts`
- Test: `src/server/__tests__/slack-ticket-input.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest"

import {
  parseSlackTicketInput,
  RequestValidationError,
  severityFromLabel,
} from "../request-validation"

describe("severityFromLabel", () => {
  it("maps labels to Linear priorities", () => {
    expect(severityFromLabel("urgent")).toBe(1)
    expect(severityFromLabel("low")).toBe(4)
    expect(severityFromLabel("nope")).toBeNull()
  })
})

describe("parseSlackTicketInput", () => {
  it("returns title, description, severity", () => {
    expect(
      parseSlackTicketInput({
        title: "Login broken",
        description: "It 500s on submit",
        severity: "high",
      })
    ).toEqual({ title: "Login broken", description: "It 500s on submit", severity: 2 })
  })

  it("rejects a short title and bad severity with field-keyed issues", () => {
    try {
      parseSlackTicketInput({ title: "x", description: "", severity: "" })
      throw new Error("should have thrown")
    } catch (error) {
      expect(error).toBeInstanceOf(RequestValidationError)
      const fields = (error as RequestValidationError).fields
      expect(Object.keys(fields).sort()).toEqual(
        ["description", "severity", "title"].sort()
      )
    }
  })
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `bun run test -- slack-ticket-input`
Expected: FAIL — `severityFromLabel`/`parseSlackTicketInput`/`fields` not defined.

- [ ] **Step 3: Implement**

In `src/server/request-validation.ts`:

a) Give `RequestValidationError` a field map (additive — keep `issues`):

```ts
export class RequestValidationError extends Error {
  constructor(
    readonly issues: string[],
    readonly fields: Record<string, string> = {}
  ) {
    super(issues.join("; "))
    this.name = "RequestValidationError"
  }
}
```

b) Export the mapping and add the parser:

```ts
export function severityFromLabel(label: string): number | null {
  return SEVERITY_PRIORITY[label.trim().toLowerCase()] ?? null
}

export type SlackTicketInput = {
  title: string
  description: string
  severity: number
}

export function parseSlackTicketInput(input: unknown): SlackTicketInput {
  const value = input && typeof input === "object" ? input : {}
  const read = (k: string) =>
    k in value && typeof (value as Record<string, unknown>)[k] === "string"
      ? ((value as Record<string, string>)[k]).trim()
      : ""

  const title = read("title")
  const description = read("description")
  const severity = severityFromLabel(read("severity"))

  const fields: Record<string, string> = {}
  if (title.length < 3 || title.length > 160)
    fields.title = "Title must be 3–160 characters"
  if (description.length < 1 || description.length > 8000)
    fields.description = "Description is required (max 8000 characters)"
  if (severity === null) fields.severity = "Pick a severity"

  if (Object.keys(fields).length > 0)
    throw new RequestValidationError(Object.values(fields), fields)

  return { title, description, severity: severity as number }
}
```

(The existing web `parseCreateRequestInput` calls `new RequestValidationError(issues)` — still valid since `fields` defaults to `{}`.)

- [ ] **Step 4: Run the test**

Run: `bun run test -- slack-ticket-input`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/request-validation.ts src/server/__tests__/slack-ticket-input.test.ts
git commit -m "feat(slack): severity mapping and slack ticket input validation"
```

---

## Task 6: Repository — email lookups + Slack-aware create

**Files:**
- Modify: `src/server/repository.ts`
- Test: covered indirectly; add a focused unit test `src/server/__tests__/repository-shape.test.ts` for `toRequestRecord`

- [ ] **Step 1: Implement `getUserIdByEmail`**

Add import at top: `import { authUsers, helpdeskRequests, linearWebhookEvents } from "./db/schema"` (add `authUsers`).

Add method to `DrizzleHelpdeskRepository`:

```ts
  async getUserIdByEmail(email: string): Promise<string | null> {
    const rows = await this.db
      .select({ id: authUsers.id })
      .from(authUsers)
      .where(eq(authUsers.email, email))
      .limit(1)
    return rows[0]?.id ?? null
  }
```

- [ ] **Step 2: Switch list/get to email**

Rename and re-key:

```ts
  async listRequestsForEmail(email: string): Promise<RequestRecord[]> {
    const rows = await this.db
      .select()
      .from(helpdeskRequests)
      .where(eq(helpdeskRequests.requesterEmail, email))
      .orderBy(desc(helpdeskRequests.createdAt))
    return rows.map(toRequestRecord)
  }

  async getRequestForEmail(
    id: string,
    email: string
  ): Promise<RequestRecord | null> {
    const rows = await this.db
      .select()
      .from(helpdeskRequests)
      .where(
        and(
          eq(helpdeskRequests.id, id),
          eq(helpdeskRequests.requesterEmail, email)
        )
      )
      .limit(1)
    const row = rows[0]
    return row ? toRequestRecord(row) : null
  }
```

- [ ] **Step 3: Slack-aware `createRequest`**

In `createRequest`'s `.values({...})`, add:

```ts
        requesterUserId: input.requesterUserId,
        source: input.source ?? "web",
        slackChannelId: input.slackChannelId ?? null,
        slackMessageTs: input.slackMessageTs ?? null,
```

(`requesterUserId` line replaces the existing one; it's now `string | null`.)

- [ ] **Step 4: Map new columns in `toRequestRecord`**

In `toRequestRecord`, add to the returned object:

```ts
    source: row.source === "slack" ? "slack" : "web",
    slackChannelId: row.slackChannelId,
    slackMessageTs: row.slackMessageTs,
```

- [ ] **Step 5: Write the failing test for `toRequestRecord` round-trip**

`src/server/__tests__/repository-shape.test.ts` — assert the record exposes `source` defaulting to `"web"` from a row-like object. (If `toRequestRecord` is not exported, export it.)

```ts
import { describe, expect, it } from "vitest"
import { toRequestRecord } from "../repository"

it("defaults unknown source to web and carries slack fields", () => {
  const record = toRequestRecord({
    id: "r", requesterUserId: null, requesterEmail: "a@b.com",
    title: "t", description: "d", linearIssueId: "i", linearIdentifier: "BAS-1",
    linearUrl: "u", linearTeamId: "team", linearStateId: "s",
    linearStateName: "Triage", linearStateType: "triage", severity: 3,
    linearDetailsCommentId: null, linearDetailsCommentedAt: null,
    source: "slack", slackChannelId: "C1", slackMessageTs: "123.45",
    createdAt: new Date(0), updatedAt: new Date(0), lastLinearSyncedAt: new Date(0),
  } as never)
  expect(record.source).toBe("slack")
  expect(record.slackChannelId).toBe("C1")
})
```

- [ ] **Step 6: Run tests**

Run: `bun run test -- repository-shape`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/server/repository.ts src/server/__tests__/repository-shape.test.ts
git commit -m "feat(slack): repository email lookups and slack-aware create"
```

---

## Task 7: `createSlackTicket` service

**Files:**
- Create: `src/server/slack/ticket.ts`
- Test: `src/server/__tests__/slack-ticket.test.ts`

This service is the heart of intake and is fully unit-testable with fakes.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from "vitest"

import { createSlackTicket, SlackEmailMissingError } from "../slack/ticket"

const issue = {
  id: "i", identifier: "BAS-1", url: "https://l/BAS-1",
  detailsCommentId: null, state: { id: "s", name: "Triage", type: "triage" },
}

function deps(email: string | null) {
  return {
    config: { linear: { teamId: "team" } },
    repo: {
      getUserIdByEmail: vi.fn(async () => (email ? "user-1" : null)),
      createRequest: vi.fn(async () => ({ id: "r" })),
    },
    linear: {
      createHelpdeskIssue: vi.fn(async () => issue),
      uploadAsset: vi.fn(async () => ({ assetUrl: "https://cdn/x.png" })),
    },
    slack: {
      getUserEmail: vi.fn(async () => email),
      downloadFile: vi.fn(async () => ({
        bytes: new Uint8Array([1]), contentType: "image/png",
      })),
    },
  } as never
}

describe("createSlackTicket", () => {
  it("rejects when the slack user has no email", async () => {
    await expect(
      createSlackTicket(deps(null), {
        slackUserId: "U1", title: "T", description: "D", severity: 2,
        channel: "C1", threadTs: "1.2", files: [],
      })
    ).rejects.toBeInstanceOf(SlackEmailMissingError)
  })

  it("creates an issue + record, attributes by email, embeds images", async () => {
    const d = deps("dev@meiro.io")
    const result = await createSlackTicket(d, {
      slackUserId: "U1", title: "Login broken", description: "500 on submit",
      severity: 2, channel: "C1", threadTs: "1.2",
      files: [{ id: "F1", name: "shot.png", mimetype: "image/png", urlPrivate: "https://files/F1" }],
    })

    expect(d.linear.createHelpdeskIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        requesterEmail: "dev@meiro.io",
        priority: 2,
        description: expect.stringContaining("![shot.png](https://cdn/x.png)"),
      })
    )
    expect(d.repo.createRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        requesterUserId: "user-1", requesterEmail: "dev@meiro.io",
        source: "slack", slackChannelId: "C1", slackMessageTs: "1.2",
      })
    )
    expect(result.issue.identifier).toBe("BAS-1")
  })

  it("still creates the ticket if an image download fails", async () => {
    const d = deps("dev@meiro.io")
    d.slack.downloadFile = vi.fn(async () => {
      throw new Error("403")
    })
    const result = await createSlackTicket(d, {
      slackUserId: "U1", title: "T", description: "D", severity: 3,
      channel: "C1", threadTs: "1.2",
      files: [{ id: "F1", name: "x.png", mimetype: "image/png", urlPrivate: "u" }],
    })
    expect(result.droppedImages).toBe(1)
    expect(d.linear.createHelpdeskIssue).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `bun run test -- slack-ticket`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import type {
  AppConfig,
  HelpdeskRepository,
  LinearGateway,
  LinearIssueSnapshot,
  RequestRecord,
  SlackFileRef,
  SlackGateway,
} from "../types"

export class SlackEmailMissingError extends Error {
  constructor() {
    super("Slack account has no email")
    this.name = "SlackEmailMissingError"
  }
}

export type SlackTicketDeps = {
  config: Pick<AppConfig, "linear">
  repo: Pick<HelpdeskRepository, "getUserIdByEmail" | "createRequest">
  linear: Pick<LinearGateway, "createHelpdeskIssue" | "uploadAsset">
  slack: Pick<SlackGateway, "getUserEmail" | "downloadFile">
}

export type CreateSlackTicketInput = {
  slackUserId: string
  title: string
  description: string
  severity: number
  channel: string
  threadTs: string
  files: SlackFileRef[]
}

export type CreateSlackTicketResult = {
  record: RequestRecord
  issue: LinearIssueSnapshot
  droppedImages: number
}

const IMAGE_MIME = /^image\//

export async function createSlackTicket(
  deps: SlackTicketDeps,
  input: CreateSlackTicketInput
): Promise<CreateSlackTicketResult> {
  const email = await deps.slack.getUserEmail(input.slackUserId)
  if (!email) throw new SlackEmailMissingError()

  let droppedImages = 0
  const markdown: string[] = []
  for (const file of input.files.filter((f) => IMAGE_MIME.test(f.mimetype))) {
    try {
      const { bytes, contentType } = await deps.slack.downloadFile(
        file.urlPrivate
      )
      const { assetUrl } = await deps.linear.uploadAsset({
        contentType: contentType || file.mimetype,
        filename: file.name,
        bytes,
      })
      markdown.push(`![${file.name}](${assetUrl})`)
    } catch {
      droppedImages += 1
    }
  }

  const description =
    markdown.length > 0
      ? `${input.description}\n\n${markdown.join("\n")}`
      : input.description

  const issue = await deps.linear.createHelpdeskIssue({
    title: input.title,
    description,
    requesterEmail: email,
    priority: input.severity,
  })

  const requesterUserId = await deps.repo.getUserIdByEmail(email)

  const record = await deps.repo.createRequest({
    requesterUserId,
    requesterEmail: email,
    title: input.title,
    description,
    severity: input.severity,
    linearIssue: issue,
    linearTeamId: deps.config.linear.teamId,
    source: "slack",
    slackChannelId: input.channel,
    slackMessageTs: input.threadTs,
  })

  return { record, issue, droppedImages }
}
```

- [ ] **Step 4: Run the test**

Run: `bun run test -- slack-ticket`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/slack/ticket.ts src/server/__tests__/slack-ticket.test.ts
git commit -m "feat(slack): createSlackTicket service"
```

---

## Task 8: Modal builder + view-submission parser (pure)

**Files:**
- Create: `src/server/slack/modal.ts`
- Test: `src/server/__tests__/slack-modal.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest"

import { buildTicketModal, parseTicketSubmission } from "../slack/modal"

describe("buildTicketModal", () => {
  it("builds a modal with prefilled description and private_metadata", () => {
    const view = buildTicketModal({
      descriptionPrefill: "from the thread",
      privateMetadata: { channel: "C1", messageTs: "1.2", threadTs: "1.2", files: [] },
    })
    expect(view.callback_id).toBe("slack_ticket_submit")
    expect(JSON.parse(view.private_metadata).channel).toBe("C1")
    const desc = view.blocks.find((b: { block_id?: string }) => b.block_id === "description")
    expect(JSON.stringify(desc)).toContain("from the thread")
  })
})

describe("parseTicketSubmission", () => {
  it("extracts field values + severity + private_metadata", () => {
    const payload = {
      user: { id: "U1" },
      view: {
        private_metadata: JSON.stringify({
          channel: "C1", messageTs: "1.2", threadTs: "1.2", files: [],
        }),
        state: {
          values: {
            title: { title_input: { value: "Login broken" } },
            description: { description_input: { value: "500" } },
            severity: { severity_input: { selected_option: { value: "high" } } },
          },
        },
      },
    }
    expect(parseTicketSubmission(payload)).toEqual({
      slackUserId: "U1",
      title: "Login broken",
      description: "500",
      severityLabel: "high",
      meta: { channel: "C1", messageTs: "1.2", threadTs: "1.2", files: [] },
    })
  })
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `bun run test -- slack-modal`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import type { SlackFileRef } from "../types"

export type TicketModalMeta = {
  channel: string
  messageTs: string
  threadTs: string
  files: SlackFileRef[]
}

const SEVERITY_OPTIONS = [
  { text: "Urgent", value: "urgent" },
  { text: "High", value: "high" },
  { text: "Medium", value: "medium" },
  { text: "Low", value: "low" },
]

export function buildTicketModal(input: {
  descriptionPrefill?: string
  privateMetadata: TicketModalMeta
}) {
  return {
    type: "modal",
    callback_id: "slack_ticket_submit",
    private_metadata: JSON.stringify(input.privateMetadata),
    title: { type: "plain_text", text: "New LinearDesk ticket" },
    submit: { type: "plain_text", text: "Create" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "input",
        block_id: "title",
        label: { type: "plain_text", text: "Title" },
        element: { type: "plain_text_input", action_id: "title_input" },
      },
      {
        type: "input",
        block_id: "description",
        label: { type: "plain_text", text: "Description" },
        element: {
          type: "plain_text_input",
          action_id: "description_input",
          multiline: true,
          initial_value: input.descriptionPrefill ?? "",
        },
      },
      {
        type: "input",
        block_id: "severity",
        label: { type: "plain_text", text: "Severity" },
        element: {
          type: "static_select",
          action_id: "severity_input",
          initial_option: {
            text: { type: "plain_text", text: "Medium" },
            value: "medium",
          },
          options: SEVERITY_OPTIONS.map((o) => ({
            text: { type: "plain_text", text: o.text },
            value: o.value,
          })),
        },
      },
    ],
  }
}

export function parseTicketSubmission(payload: {
  user: { id: string }
  view: { private_metadata: string; state: { values: Record<string, Record<string, { value?: string; selected_option?: { value: string } }>> } }
}) {
  const v = payload.view.state.values
  return {
    slackUserId: payload.user.id,
    title: v.title?.title_input?.value?.trim() ?? "",
    description: v.description?.description_input?.value?.trim() ?? "",
    severityLabel: v.severity?.severity_input?.selected_option?.value ?? "",
    meta: JSON.parse(payload.view.private_metadata) as TicketModalMeta,
  }
}
```

- [ ] **Step 4: Run the test**

Run: `bun run test -- slack-modal`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/slack/modal.ts src/server/__tests__/slack-modal.test.ts
git commit -m "feat(slack): modal builder and submission parser"
```

---

## Task 9: Slack gateway adapter (reference impl, verified live)

**Files:**
- Create: `src/server/slack/gateway.ts`

This is a thin `fetch` wrapper over the Slack Web API. It is the manually-verified seam (no unit test — an HTTP adapter); all callers are tested against the `SlackGateway` fake.

- [ ] **Step 1: Implement**

```ts
import type { SlackGateway } from "../types"

const API = "https://slack.com/api"

export function createSlackGateway(botToken: string): SlackGateway {
  async function call<T>(method: string, body: unknown): Promise<T> {
    const res = await fetch(`${API}/${method}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${botToken}`,
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(body),
    })
    const data = (await res.json()) as { ok: boolean; error?: string } & T
    if (!data.ok) throw new Error(`Slack ${method} failed: ${data.error}`)
    return data
  }

  return {
    async openView(triggerId, view) {
      await call("views.open", { trigger_id: triggerId, view })
    },
    async postMessage(input) {
      const data = await call<{ ts: string; channel: string }>(
        "chat.postMessage",
        { channel: input.channel, thread_ts: input.threadTs, text: input.text }
      )
      return { channel: data.channel, ts: data.ts }
    },
    async getUserEmail(userId) {
      const data = await call<{ user: { profile?: { email?: string } } }>(
        "users.info",
        { user: userId }
      )
      return data.user.profile?.email ?? null
    },
    async downloadFile(urlPrivate) {
      const res = await fetch(urlPrivate, {
        headers: { authorization: `Bearer ${botToken}` },
      })
      if (!res.ok) throw new Error(`Slack file download failed: ${res.status}`)
      const contentType = res.headers.get("content-type") ?? "application/octet-stream"
      const bytes = new Uint8Array(await res.arrayBuffer())
      return { bytes, contentType }
    },
  }
}
```

> Live-verify in the manual checklist: `users.info` requires the `users:read.email` scope; `downloadFile` requires `files:read` and the bot being in the channel; `chat.postMessage` requires `chat:write`.

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: no new errors in `gateway.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/server/slack/gateway.ts
git commit -m "feat(slack): slack web api gateway adapter"
```

---

## Task 10: Routes + dependency wiring + feature gating

**Files:**
- Modify: `src/server/app.ts`
- Test: `src/server/__tests__/slack-routes.test.ts`

- [ ] **Step 1: Wire the dependency + email-keyed callers**

In `app.ts`:
- Add `slack?: SlackGateway` to `ApiDependencies` (import `SlackGateway`).
- In `createDefaultDependencies`, after building `linear`, add:
  ```ts
    slack: config.slack ? createSlackGateway(config.slack.botToken) : undefined,
  ```
  (import `createSlackGateway` from `./slack/gateway`).
- Change the two request-list callers: `repo.listRequestsForUser(session.user.id)` → `repo.listRequestsForEmail(session.user.email)`; `repo.getRequestForUser(params.id, session.user.id)` → `repo.getRequestForEmail(params.id, session.user.email)`.
- In the web `POST /requests`, set `requesterUserId: session.user.id` and add `source: "web"` to the `createRequest` call.
- In `serializeRequest`, add `source: record.source`.

- [ ] **Step 2: Write the failing route tests**

```ts
import { describe, expect, it, vi } from "vitest"
import { createApiApp } from "../app"
// reuse config + makeRepo pattern from app.test.ts (copy the helpers in)

function slackHeaders(secret: string, body: string) {
  const ts = String(Math.floor(Date.now() / 1000))
  const sig = `v0=${require("node:crypto").createHmac("sha256", secret).update(`v0:${ts}:${body}`).digest("hex")}`
  return { "x-slack-signature": sig, "x-slack-request-timestamp": ts, "content-type": "application/x-www-form-urlencoded" }
}

it("does not mount slack routes when slack is unconfigured", async () => {
  const app = createApiApp({ config, repo: makeRepo(), linear: makeLinear(), auth: { getSession: vi.fn(async () => null) } })
  const res = await app.fetch(new Request("http://localhost/api/slack/commands", { method: "POST", body: "" }))
  expect(res.status).toBe(404)
})

it("opens a modal on /ticket when configured", async () => {
  const slack = { openView: vi.fn(async () => {}), postMessage: vi.fn(), getUserEmail: vi.fn(), downloadFile: vi.fn() }
  const cfg = { ...config, slack: { signingSecret: "sign", botToken: "xoxb" } }
  const app = createApiApp({ config: cfg, repo: makeRepo(), linear: makeLinear(), slack, auth: { getSession: vi.fn(async () => null) } })
  const body = new URLSearchParams({ trigger_id: "T1", channel_id: "C1", user_id: "U1", command: "/ticket", text: "" }).toString()
  const res = await app.fetch(new Request("http://localhost/api/slack/commands", { method: "POST", headers: slackHeaders("sign", body), body }))
  expect(res.status).toBe(200)
  expect(slack.openView).toHaveBeenCalledWith("T1", expect.objectContaining({ callback_id: "slack_ticket_submit" }))
})

it("rejects a bad signature", async () => {
  const slack = { openView: vi.fn(), postMessage: vi.fn(), getUserEmail: vi.fn(), downloadFile: vi.fn() }
  const cfg = { ...config, slack: { signingSecret: "sign", botToken: "xoxb" } }
  const app = createApiApp({ config: cfg, repo: makeRepo(), linear: makeLinear(), slack, auth: { getSession: vi.fn(async () => null) } })
  const res = await app.fetch(new Request("http://localhost/api/slack/commands", { method: "POST", headers: { "x-slack-signature": "v0=bad", "x-slack-request-timestamp": "1", "content-type": "application/x-www-form-urlencoded" }, body: "x=1" }))
  expect(res.status).toBe(401)
  expect(slack.openView).not.toHaveBeenCalled()
})
```

Add `makeLinear()` returning the 6-method fake (copy from `app.test.ts`).

- [ ] **Step 3: Run to confirm failure**

Run: `bun run test -- slack-routes`
Expected: FAIL — routes return 404 / not implemented.

- [ ] **Step 4: Implement the routes**

Add a guarded block in `createApiApp`'s chain (before `.mount(authHandler)`). Use `request.text()` for the raw body (signature requires it), verify, then parse form-encoding.

```ts
    .post("/slack/commands", async ({ request }) => {
      const deps = getDependencies()
      if (!deps.slack || !deps.config.slack) return json({ error: "not_found" }, 404)
      const raw = await request.text()
      if (!verifySlackSignature({
        signingSecret: deps.config.slack.signingSecret,
        signature: request.headers.get("x-slack-signature"),
        timestamp: request.headers.get("x-slack-request-timestamp"),
        rawBody: raw,
        nowMs: Date.now(),
      })) return json({ error: "bad_signature" }, 401)

      const form = new URLSearchParams(raw)
      const triggerId = form.get("trigger_id")
      const channel = form.get("channel_id") ?? ""
      if (!triggerId) return json({ error: "no_trigger" }, 400)

      await deps.slack.openView(
        triggerId,
        buildTicketModal({
          privateMetadata: { channel, messageTs: "", threadTs: "", files: [] },
        })
      )
      return new Response("", { status: 200 })
    })
    .post("/slack/interactivity", async ({ request }) => {
      const deps = getDependencies()
      if (!deps.slack || !deps.config.slack) return json({ error: "not_found" }, 404)
      const raw = await request.text()
      if (!verifySlackSignature({
        signingSecret: deps.config.slack.signingSecret,
        signature: request.headers.get("x-slack-signature"),
        timestamp: request.headers.get("x-slack-request-timestamp"),
        rawBody: raw,
        nowMs: Date.now(),
      })) return json({ error: "bad_signature" }, 401)

      const payload = JSON.parse(new URLSearchParams(raw).get("payload") ?? "{}")

      // Message shortcut → open modal seeded from the message.
      if (payload.type === "message_action") {
        const files = Array.isArray(payload.message?.files)
          ? payload.message.files.map((f: { id: string; name: string; mimetype: string; url_private: string }) => ({
              id: f.id, name: f.name, mimetype: f.mimetype, urlPrivate: f.url_private,
            }))
          : []
        await deps.slack.openView(
          payload.trigger_id,
          buildTicketModal({
            descriptionPrefill: payload.message?.text ?? "",
            privateMetadata: {
              channel: payload.channel.id,
              messageTs: payload.message.ts,
              threadTs: payload.message.thread_ts ?? payload.message.ts,
              files,
            },
          })
        )
        return new Response("", { status: 200 })
      }

      // Modal submit → validate; on error return field errors; else ack + work.
      if (payload.type === "view_submission" &&
          payload.view?.callback_id === "slack_ticket_submit") {
        const parsed = parseTicketSubmission(payload)
        let input
        try {
          input = parseSlackTicketInput({
            title: parsed.title,
            description: parsed.description,
            severity: parsed.severityLabel,
          })
        } catch (error) {
          if (error instanceof RequestValidationError) {
            return json({ response_action: "errors", errors: error.fields }, 200)
          }
          throw error
        }

        const work = (async () => {
          try {
            const result = await createSlackTicket(
              { config: deps.config, repo: deps.repo, linear: deps.linear, slack: deps.slack! },
              {
                slackUserId: parsed.slackUserId,
                title: input.title,
                description: input.description,
                severity: input.severity,
                channel: parsed.meta.channel,
                threadTs: parsed.meta.threadTs,
                files: parsed.meta.files,
              }
            )
            const note = result.droppedImages > 0
              ? ` (couldn't attach ${result.droppedImages} image(s))`
              : ""
            await deps.slack!.postMessage({
              channel: parsed.meta.channel,
              threadTs: parsed.meta.threadTs || undefined,
              text: `:white_check_mark: Created *${result.issue.identifier}* — ${result.issue.url}${note}`,
            })
          } catch (error) {
            const text = error instanceof SlackEmailMissingError
              ? ":warning: Your Slack account has no email, so I couldn't create a ticket."
              : ":x: Sorry — creating the ticket failed. Please try again."
            await deps.slack!.postMessage({
              channel: parsed.meta.channel,
              threadTs: parsed.meta.threadTs || undefined,
              text,
            })
          }
        })()

        scheduleBackground(request, work)
        return new Response("", { status: 200 })
      }

      return new Response("", { status: 200 })
    })
```

Add imports at the top of `app.ts`:

```ts
import { createSlackGateway } from "./slack/gateway"
import { buildTicketModal, parseTicketSubmission } from "./slack/modal"
import { createSlackTicket, SlackEmailMissingError } from "./slack/ticket"
import { verifySlackSignature } from "./slack/signature"
```

Add `parseSlackTicketInput` to the existing `./request-validation` import.

Add a `scheduleBackground` helper near the top of `app.ts` (keeps the function alive after the 200 on serverless; runs inline locally):

```ts
function scheduleBackground(request: Request, work: Promise<unknown>) {
  const safe = work.catch((error) => {
    console.error("slack background work failed", error)
  })
  const ctx = (request as { waitUntil?: (p: Promise<unknown>) => void }).waitUntil
  // Nitro/Vercel expose waitUntil on the request/event; fall back to fire-and-forget.
  if (typeof ctx === "function") ctx(safe)
  else void safe
}
```

> **Live-verify:** confirm `waitUntil` is actually invoked on Nitro-Vercel (log inside `work`). If the background work is being killed after the 200, switch `scheduleBackground` to use the Nitro event context (`event.waitUntil`) wired through the request, or move ticket creation in front of the ack and accept the ~3s budget. This is the one serverless risk in Plan A.

- [ ] **Step 5: Run the route tests**

Run: `bun run test -- slack-routes`
Expected: PASS (mount gating, modal open, bad signature).

- [ ] **Step 6: Fix `app.test.ts` for renamed repo methods**

Update `makeRepo()` in `src/server/__tests__/app.test.ts`: remove `listRequestsForUser`/`getRequestForUser`, add `getUserIdByEmail: vi.fn(async () => "user-id")`, `listRequestsForEmail: vi.fn(async () => [makeRecord()])`, `getRequestForEmail: vi.fn(async () => makeRecord())`. Update `makeRecord` to include `source: "web"`, `slackChannelId: null`, `slackMessageTs: null`, and keep `requesterUserId: "user-id"`.

- [ ] **Step 7: Full suite + typecheck + lint**

Run: `bun run typecheck && bun run lint && bun run test`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add src/server/app.ts src/server/__tests__/
git commit -m "feat(slack): /ticket + interactivity routes with feature gating"
```

---

## Task 11: Client type + portal source field

**Files:**
- Modify: `src/lib/helpdesk-api.ts:1-19`

- [ ] **Step 1: Add `source` to `PortalRequest`**

Add `source: "web" | "slack"` to the `PortalRequest` type. (UI badge is out of scope; this just keeps the client type honest with the API.)

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: green.

- [ ] **Step 3: Commit**

```bash
git add src/lib/helpdesk-api.ts
git commit -m "feat(slack): expose request source to the client type"
```

---

## Task 12: Docs, env, manifest, local helper

**Files:**
- Modify: `.env.example`, `README.md`
- Create: `docs/slack-app-manifest.md`, `scripts/send-test-slack.ts`

- [ ] **Step 1: `.env.example`** — add (commented as optional):

```
# Optional: enable Slack intake. Both must be set for /api/slack/* to mount.
SLACK_SIGNING_SECRET=
SLACK_BOT_TOKEN=
```

- [ ] **Step 2: `README.md`** — add a "Slack intake (optional)" section: install the app from the manifest, set the two env vars in Vercel, invite the bot to channels (`/invite @LinearDesk`), use `/ticket` or the message shortcut. Note that updates back to Slack are a follow-up (Plan B).

- [ ] **Step 3: `docs/slack-app-manifest.md`** — commit a Slack app manifest:

```yaml
display_information:
  name: LinearDesk
features:
  bot_user:
    display_name: LinearDesk
  slash_commands:
    - command: /ticket
      url: https://lineardesk.vercel.app/api/slack/commands
      description: File a LinearDesk ticket
  shortcuts:
    - name: Create LinearDesk ticket
      type: message
      callback_id: slack_ticket_submit
      description: Turn this message into a LinearDesk ticket
oauth_config:
  scopes:
    bot: [commands, chat:write, users:read, users:read.email, files:read]
settings:
  interactivity:
    is_enabled: true
    request_url: https://lineardesk.vercel.app/api/slack/interactivity
```

- [ ] **Step 4: `scripts/send-test-slack.ts`** — a Bun helper mirroring `send-test-webhook.ts` that signs a form-encoded `/api/slack/commands` body with `SLACK_SIGNING_SECRET` and POSTs it, for local testing without Slack.

- [ ] **Step 5: Commit**

```bash
git add .env.example README.md docs/slack-app-manifest.md scripts/send-test-slack.ts
git commit -m "docs(slack): env, README, app manifest, local helper"
```

---

## Manual verification (post-merge, live)

Not automatable — requires a real Slack workspace:

1. Create the Slack app from `docs/slack-app-manifest.md`; install to the workspace.
2. Set `SLACK_SIGNING_SECRET` + `SLACK_BOT_TOKEN` in Vercel; redeploy.
3. `/invite @LinearDesk` into a test channel.
4. Run `/ticket` → modal opens → submit → confirm a ticket appears in Linear **and** in the LinearDesk portal under that email.
5. Post a message with an image → `⋯ → Create LinearDesk ticket` → submit → confirm the image is embedded on the Linear issue and the confirmation lands in the thread.
6. Confirm `waitUntil` kept the background work alive (the confirmation message posts after the modal closes).

---

## Self-review

**Spec coverage:** intake (Tasks 8, 10) ✓; lighter modal (8) ✓; email attribution, reject-if-no-email (7) ✓; portal visibility by email (6, 10) ✓; images via uploadAsset (7) ✓; optional/feature-gated (3, 10) ✓; single-workspace env token (3, 9) ✓; signature security (4, 10) ✓; tests throughout ✓; docs (12) ✓. **Deferred to Plan B (by design):** `attachmentLinkSlack` and updates back to Slack — *not* a gap.

**Placeholder scan:** no TBDs; the two reference-impl adapters (Tasks 9, the `scheduleBackground` seam in 10) are explicitly flagged for live verification, not left vague.

**Type consistency:** `SlackGateway` (openView/postMessage/getUserEmail/downloadFile), `SlackFileRef` (urlPrivate), `CreateSlackTicketInput`, `parseSlackTicketInput → {title,description,severity}`, repo `listRequestsForEmail`/`getRequestForEmail`/`getUserIdByEmail`, record `source`/`slackChannelId`/`slackMessageTs` — all defined in Tasks 2/6/7/8 and used consistently in Task 10.

**Known risk:** serverless background execution after the Slack ack (`scheduleBackground`) — flagged in Task 10 with a fallback.
