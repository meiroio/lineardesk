# @mention auto-create + portal self-edit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the ticket owner edit a non-terminal ticket's Title/Description/Severity from the portal, and let `@LinearDesk` in a Slack thread auto-create an AI-drafted ticket (with thread images) that links back to that edit page.

**Architecture:** Two phases. Phase 1 adds a portal edit form + `POST /api/requests/:id/update` → Linear `updateIssue` + DB update (mirrors the existing `/close` route). Phase 2 adds a Slack Events API route (`/api/slack/events`) that, on `app_mention`, reads the thread, drafts with Gemini, gathers thread images, calls the existing `createSlackTicket`, and posts a confirmation linking to the portal edit. Dedup by Slack `event_id`; degrade gracefully without Gemini.

**Tech Stack:** TypeScript, Elysia, Drizzle/Postgres, TanStack Start + React Query, Slack Web API + Events API, Gemini, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-13-mention-autocreate-portal-edit-design.md`

---

## File structure

**Create**
- `src/server/slack/events.ts` — pure helpers: url-verification detection + `app_mention` extraction/bot-filter.
- `src/server/__tests__/slack-events.test.ts`
- `drizzle/` migration for `slack_events`.

**Modify**
- `src/server/types.ts` — `LinearGateway.updateIssueFields`; `HelpdeskRepository.updateRequestFields` + `hasProcessedSlackEvent`/`recordSlackEvent`; `SlackGateway.getThreadReplies` return gains `files`.
- `src/server/linear.ts` — `updateIssueFields`.
- `src/server/repository.ts` — `updateRequestFields`, `hasProcessedSlackEvent`, `recordSlackEvent`.
- `src/server/request-validation.ts` — `parseUpdateRequestInput`.
- `src/server/db/schema.ts` — `slack_events` table.
- `src/server/slack/gateway.ts` — `getThreadReplies` returns `files`.
- `src/server/app.ts` — `POST /api/requests/:id/update`; `POST /api/slack/events` + the mention background flow.
- `src/lib/helpdesk-api.ts` — `updateRequest` client.
- `src/routes/requests/$requestId.tsx` — edit form.
- `src/server/__tests__/app.test.ts`, `src/server/__tests__/slack-routes.test.ts` — mocks + route tests.
- `.env.example` not needed (no new env); `README.md`, `docs/slack-app-manifest.md` — `app_mentions:read` + Events URL.

---

# PHASE 1 — Portal field editing

## Task C1: Linear `updateIssueFields` + repo `updateRequestFields`

**Files:** Modify `src/server/types.ts`, `src/server/linear.ts`, `src/server/repository.ts`

- [ ] **Step 1: Types** — in `src/server/types.ts`, add to `LinearGateway`:
```ts
  updateIssueFields: (input: {
    issueId: string
    title: string
    description: string
    priority: number
  }) => Promise<void>
```
and to `HelpdeskRepository`:
```ts
  updateRequestFields: (input: {
    id: string
    title: string
    description: string
    severity: number
  }) => Promise<RequestRecord | null>
```

- [ ] **Step 2: Linear impl** — in `src/server/linear.ts`, add to the `LinearSdkGateway` class (mirrors `closeIssue`'s use of `client.updateIssue`):
```ts
  async updateIssueFields(input: {
    issueId: string
    title: string
    description: string
    priority: number
  }): Promise<void> {
    const payload = await this.client.updateIssue(input.issueId, {
      title: input.title,
      description: input.description,
      priority: input.priority,
    })
    if (!payload.success) throw new Error("Linear issue update failed")
  }
```

- [ ] **Step 3: Repo impl** — in `src/server/repository.ts`, add to `DrizzleHelpdeskRepository` (uses `eq`, `helpdeskRequests`, `toRequestRecord`, all already imported):
```ts
  async updateRequestFields(input: {
    id: string
    title: string
    description: string
    severity: number
  }): Promise<RequestRecord | null> {
    const rows = await this.db
      .update(helpdeskRequests)
      .set({
        title: input.title,
        description: input.description,
        severity: input.severity,
        updatedAt: new Date(),
      })
      .where(eq(helpdeskRequests.id, input.id))
      .returning()
    const row = rows[0]
    return row ? toRequestRecord(row) : null
  }
```

- [ ] **Step 4: Typecheck** — `bun run typecheck 2>&1 | grep -E "linear.ts|repository.ts|types.ts"` → no output (mocks in tests now lack these methods → expected errors only in `app.test.ts`/`slack-routes.test.ts`, fixed in Task C3).

- [ ] **Step 5: Commit**
```bash
git add src/server/types.ts src/server/linear.ts src/server/repository.ts
git commit -m "feat(edit): linear updateIssueFields + repo updateRequestFields"
```

---

## Task C2: `parseUpdateRequestInput`

**Files:** Modify `src/server/request-validation.ts`; Test `src/server/__tests__/request-validation.test.ts`

- [ ] **Step 1: Failing test** — append:
```ts
import { parseUpdateRequestInput } from "../request-validation"

describe("parseUpdateRequestInput", () => {
  it("returns title, description (verbatim), severity", () => {
    expect(
      parseUpdateRequestInput({
        title: "Login broken",
        description: "Expected\n\nCurrent\n\nSteps",
        severity: "high",
      })
    ).toEqual({
      title: "Login broken",
      description: "Expected\n\nCurrent\n\nSteps",
      severity: 2,
    })
  })

  it("flags bad fields with a per-field map", () => {
    try {
      parseUpdateRequestInput({ title: "x", description: "", severity: "" })
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
(`RequestValidationError` is already imported in the test file.)

- [ ] **Step 2: Run** — `bun run test -- request-validation` → FAIL (not defined).

- [ ] **Step 3: Implement** — in `src/server/request-validation.ts`:
```ts
export function parseUpdateRequestInput(input: unknown): CreateRequestInput {
  const value = input && typeof input === "object" ? input : {}
  const read = (k: string) => {
    const raw = (value as Record<string, unknown>)[k]
    return typeof raw === "string" ? raw.trim() : ""
  }

  const title = read("title")
  const description = read("description")
  const severity = SEVERITY_PRIORITY[read("severity").toLowerCase()]

  const fields: Record<string, string> = {}
  if (title.length < 3 || title.length > 160)
    fields.title = "Title must be 3–160 characters"
  if (description.length < 1 || description.length > 8000)
    fields.description = "Description is required (max 8000 characters)"
  if (!severity) fields.severity = "Pick a severity"

  if (Object.keys(fields).length > 0)
    throw new RequestValidationError(Object.values(fields), fields)

  return { title, description, severity }
}
```

- [ ] **Step 4: Run** — `bun run test -- request-validation` → PASS (existing + 2 new).

- [ ] **Step 5: Commit**
```bash
git add src/server/request-validation.ts src/server/__tests__/request-validation.test.ts
git commit -m "feat(edit): parseUpdateRequestInput (freeform description)"
```

---

## Task C3: `POST /api/requests/:id/update` route

**Files:** Modify `src/server/app.ts`, `src/server/__tests__/app.test.ts`

- [ ] **Step 1: Add the route** in `app.ts` immediately after the `/requests/:id/close` route (mirrors it; `parseUpdateRequestInput` import added to the existing `./request-validation` import; `isDoneStatus` is NOT imported server-side — check terminal inline with the same set the repo uses):
```ts
    .post("/requests/:id/update", async ({ params, body, request }) => {
      const deps = getDependencies()
      const session = await requireAuthorizedSession(deps, request.headers)
      if (session instanceof Response) return session

      let input: ReturnType<typeof parseUpdateRequestInput>
      try {
        input = parseUpdateRequestInput(body)
      } catch (error) {
        if (error instanceof RequestValidationError) {
          return json(
            { error: "validation_error", issues: error.issues, fields: error.fields },
            400
          )
        }
        throw error
      }

      const record = await deps.repo.getRequestForEmail(
        params.id,
        session.user.email
      )
      if (!record) return json({ error: "not_found" }, 404)
      if (["completed", "canceled", "duplicate"].includes(record.linearStateType)) {
        return json({ error: "ticket_closed" }, 409)
      }

      await deps.linear.updateIssueFields({
        issueId: record.linearIssueId,
        title: input.title,
        description: input.description,
        priority: input.severity,
      })
      const updated = await deps.repo.updateRequestFields({
        id: record.id,
        title: input.title,
        description: input.description,
        severity: input.severity,
      })
      return { request: serializeRequest(updated ?? record) }
    })
```

- [ ] **Step 2: Fix the mocks** in `src/server/__tests__/app.test.ts`: add `updateIssueFields: vi.fn()` to every inline `linear` mock and the `makeLinear` helper; add `updateRequestFields: vi.fn(async () => makeRecord())` to `makeRepo`.

- [ ] **Step 3: Write route tests** in `app.test.ts`:
```ts
it("updates a request's fields for its owner", async () => {
  const repo = makeRepo()
  const linear = makeLinear()
  const app = createApiApp({
    config, repo, linear,
    auth: { getSession: vi.fn(async () => session) },
  })
  const res = await app.fetch(
    new Request("http://localhost/api/requests/request-id/update", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Edited title",
        description: "Expected\n\nCurrent\n\nSteps",
        severity: "urgent",
      }),
    })
  )
  expect(res.status).toBe(200)
  expect(linear.updateIssueFields).toHaveBeenCalledWith(
    expect.objectContaining({ title: "Edited title", priority: 1 })
  )
  expect(repo.updateRequestFields).toHaveBeenCalled()
})

it("rejects editing a closed ticket with 409", async () => {
  const repo = makeRepo()
  repo.getRequestForEmail = vi.fn(async () =>
    makeRecord({ linearStateType: "completed" })
  )
  const app = createApiApp({
    config, repo, linear: makeLinear(),
    auth: { getSession: vi.fn(async () => session) },
  })
  const res = await app.fetch(
    new Request("http://localhost/api/requests/request-id/update", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "x".repeat(5), description: "d", severity: "low" }),
    })
  )
  expect(res.status).toBe(409)
})
```
(`makeLinear` must exist in app.test.ts; if the file uses inline linear mocks only, add a `makeLinear()` helper returning all `LinearGateway` methods incl. `updateIssueFields`.)

- [ ] **Step 4: Verify** — `bun run typecheck && bun run lint && bun run test` → all green.

- [ ] **Step 5: Commit**
```bash
git add src/server/app.ts src/server/__tests__/app.test.ts
git commit -m "feat(edit): POST /api/requests/:id/update route"
```

---

## Task C4: Client `updateRequest` + portal edit form

**Files:** Modify `src/lib/helpdesk-api.ts`, `src/routes/requests/$requestId.tsx`

- [ ] **Step 1: Client fn** — in `src/lib/helpdesk-api.ts`, after `closeRequest`:
```ts
export async function updateRequest(
  id: string,
  input: { title: string; description: string; severity: string }
): Promise<{ request: PortalRequest }> {
  return apiPost<{ request: PortalRequest }>(`/api/requests/${id}/update`, input)
}
```

- [ ] **Step 2: Edit UI** — in `$requestId.tsx`:
  - Add imports: `updateRequest` to the `@/lib/helpdesk-api` import; `Input` from `@/components/ui/input` (the create form uses it — confirm the path).
  - Add state near the others:
```ts
  const [editing, setEditing] = useState(false)
  const [editBusy, setEditBusy] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState("")
  const [editDescription, setEditDescription] = useState("")
  const [editSeverity, setEditSeverity] = useState("medium")
```
  - Add a handler (mirrors `handleClose`):
```ts
  function startEditing() {
    if (!request) return
    setEditTitle(request.title)
    setEditDescription(request.description)
    setEditSeverity(severityLabelOf(request.severity))
    setEditError(null)
    setEditing(true)
  }

  async function handleEditSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setEditBusy(true)
    setEditError(null)
    try {
      const data = await updateRequest(requestId, {
        title: editTitle,
        description: editDescription,
        severity: editSeverity,
      })
      queryClient.setQueryData<PortalRequest>(
        requestKeys.detail(requestId),
        (old) => (old ? { ...old, ...data.request, comments: old.comments } : data.request)
      )
      void queryClient.invalidateQueries({ queryKey: requestKeys.list })
      setEditing(false)
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        void navigate({ to: "/login" })
        return
      }
      setEditError("Could not save changes. Try again after a moment.")
    } finally {
      setEditBusy(false)
    }
  }
```
  - Add a `severityLabelOf` helper near `initialsOf`:
```ts
function severityLabelOf(priority: number | null) {
  return { 1: "urgent", 2: "high", 3: "medium", 4: "low" }[priority ?? 3] ?? "medium"
}
```
  - In the Description `Card`, show an **Edit** button in the header when `isOpen`, toggling between the read view (`<DescriptionBody />`) and a form with: Title `<Input>`, Description `<Textarea>` (prefilled `editDescription`), Severity `<select>` (urgent/high/medium/low), Save + Cancel buttons, and `editError`. Wire the form `onSubmit={handleEditSubmit}`, the title to `editTitle`/`setEditTitle`, description to `editDescription`/`setEditDescription`, severity to `editSeverity`/`setEditSeverity`. Show the form when `editing`, else the read view + Edit button.

- [ ] **Step 3: Verify** — `bun run typecheck && bun run lint && bun run test` → green. If `@/components/ui/input` doesn't exist, use the create form's input element (check `src/routes/requests/new.tsx` for the exact component) — match it.

- [ ] **Step 4: Commit**
```bash
git add src/lib/helpdesk-api.ts src/routes/requests/$requestId.tsx
git commit -m "feat(edit): portal edit form for ticket fields"
```

---

# PHASE 2 — Slack @mention auto-create

## Task C5: `getThreadReplies` returns files

**Files:** Modify `src/server/types.ts`, `src/server/slack/gateway.ts`, `src/server/__tests__/slack-routes.test.ts`

- [ ] **Step 1: Type** — in `src/server/types.ts`, change `getThreadReplies` return to include files:
```ts
  getThreadReplies: (input: {
    channel: string
    threadTs: string
  }) => Promise<{
    messages: { user: string | null; text: string; files: SlackFileRef[] }[]
  }>
```

- [ ] **Step 2: Impl** — in `src/server/slack/gateway.ts`, update `getThreadReplies`'s mapping:
```ts
    async getThreadReplies(input) {
      const data = await callGet<{
        messages?: {
          user?: string
          text?: string
          files?: {
            id: string
            name: string
            mimetype: string
            url_private: string
          }[]
        }[]
      }>("conversations.replies", {
        channel: input.channel,
        ts: input.threadTs,
        limit: "200",
      })
      return {
        messages: (data.messages ?? []).map((m) => ({
          user: m.user ?? null,
          text: m.text ?? "",
          files: (m.files ?? []).map((f) => ({
            id: f.id,
            name: f.name,
            mimetype: f.mimetype,
            urlPrivate: f.url_private,
          })),
        })),
      }
    },
```

- [ ] **Step 3: Fix mocks** — in `slack-routes.test.ts`, `makeSlack().getThreadReplies` now returns `{ messages: [] }` — that still satisfies the type (empty array). Where a test sets `getThreadReplies` to return messages, add `files: []` to each message object.

- [ ] **Step 4: Verify** — `bun run typecheck 2>&1 | grep "slack/gateway.ts"` empty; `bun run test -- slack-routes` green (existing AI tests still pass — they ignore files).

- [ ] **Step 5: Commit**
```bash
git add src/server/types.ts src/server/slack/gateway.ts src/server/__tests__/slack-routes.test.ts
git commit -m "feat(mention): getThreadReplies returns per-message files"
```

---

## Task C6: `slack_events` dedup table + repo methods

**Files:** Modify `src/server/db/schema.ts`, `src/server/types.ts`, `src/server/repository.ts`; generate migration

- [ ] **Step 1: Schema** — in `src/server/db/schema.ts`, after `linearWebhookEvents`:
```ts
export const slackEvents = pgTable("slack_events", {
  eventId: text("event_id").primaryKey(),
  receivedAt: timestamp("received_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
})
```

- [ ] **Step 2: Generate migration** — `bun run db:generate` → a new `drizzle/*.sql` with `CREATE TABLE "slack_events" (...)`. Review it's only that table.

- [ ] **Step 3: Apply locally (CAUTION — `.env.local` points at prod)** — `DATABASE_URL='postgres://lineardesk:lineardesk@localhost:5433/lineardesk' bun run db:migrate`. If the local DB isn't set up, commit anyway and note it (prod is migrated via `db:migrate:prod` at deploy).

- [ ] **Step 4: Types + repo** — in `types.ts`, add to `HelpdeskRepository`:
```ts
  hasProcessedSlackEvent: (eventId: string) => Promise<boolean>
  recordSlackEvent: (eventId: string) => Promise<void>
```
In `repository.ts` (import `slackEvents`; mirror `hasProcessedWebhookEvent`/`recordWebhookEvent`):
```ts
  async hasProcessedSlackEvent(eventId: string): Promise<boolean> {
    const rows = await this.db
      .select({ eventId: slackEvents.eventId })
      .from(slackEvents)
      .where(eq(slackEvents.eventId, eventId))
      .limit(1)
    return rows.length > 0
  }

  async recordSlackEvent(eventId: string): Promise<void> {
    await this.db
      .insert(slackEvents)
      .values({ eventId })
      .onConflictDoNothing()
  }
```

- [ ] **Step 5: Fix mocks** — add `hasProcessedSlackEvent: vi.fn(async () => false)` and `recordSlackEvent: vi.fn(async () => undefined)` to `makeRepo` in both `app.test.ts` and `slack-routes.test.ts` and `reconcile.test.ts`.

- [ ] **Step 6: Verify** — `bun run typecheck && bun run test` green.

- [ ] **Step 7: Commit**
```bash
git add src/server/db/schema.ts drizzle/ src/server/types.ts src/server/repository.ts src/server/__tests__/
git commit -m "feat(mention): slack_events dedup table + repo methods"
```

---

## Task C7: Events helpers (`slack/events.ts`)

**Files:** Create `src/server/slack/events.ts`, `src/server/__tests__/slack-events.test.ts`

- [ ] **Step 1: Failing test**
```ts
import { describe, expect, it } from "vitest"

import { extractMention, isUrlVerification } from "../slack/events"

describe("isUrlVerification", () => {
  it("detects the handshake", () => {
    expect(isUrlVerification({ type: "url_verification", challenge: "c" })).toBe(true)
    expect(isUrlVerification({ type: "event_callback" })).toBe(false)
  })
})

describe("extractMention", () => {
  const base = {
    event_id: "Ev1",
    event: {
      type: "app_mention",
      user: "U1",
      channel: "C1",
      ts: "1.1",
      thread_ts: "1.0",
    },
  }
  it("pulls eventId + channel + thread root + user", () => {
    expect(extractMention(base)).toEqual({
      eventId: "Ev1",
      user: "U1",
      channel: "C1",
      threadTs: "1.0",
    })
  })
  it("falls back to ts when not in a thread", () => {
    expect(
      extractMention({ ...base, event: { ...base.event, thread_ts: undefined } })?.threadTs
    ).toBe("1.1")
  })
  it("returns null for bot messages and non-mentions", () => {
    expect(extractMention({ event_id: "E", event: { type: "app_mention", bot_id: "B1", user: "U1", channel: "C1", ts: "1.1" } })).toBeNull()
    expect(extractMention({ event_id: "E", event: { type: "message", user: "U1", channel: "C1", ts: "1.1" } })).toBeNull()
  })
})
```

- [ ] **Step 2: Run** — `bun run test -- slack-events` → FAIL.

- [ ] **Step 3: Implement** `src/server/slack/events.ts`:
```ts
type SlackEventEnvelope = {
  type?: string
  challenge?: string
  event_id?: string
  event?: {
    type?: string
    user?: string
    channel?: string
    ts?: string
    thread_ts?: string
    bot_id?: string
  }
}

export function isUrlVerification(payload: SlackEventEnvelope): boolean {
  return payload.type === "url_verification"
}

export function extractMention(payload: SlackEventEnvelope): {
  eventId: string
  user: string
  channel: string
  threadTs: string
} | null {
  const e = payload.event
  if (!e || e.type !== "app_mention") return null
  if (e.bot_id) return null
  if (!payload.event_id || !e.user || !e.channel || !e.ts) return null
  return {
    eventId: payload.event_id,
    user: e.user,
    channel: e.channel,
    threadTs: e.thread_ts ?? e.ts,
  }
}
```

- [ ] **Step 4: Run** — `bun run test -- slack-events` → PASS.

- [ ] **Step 5: Commit**
```bash
git add src/server/slack/events.ts src/server/__tests__/slack-events.test.ts
git commit -m "feat(mention): slack events parsing helpers"
```

---

## Task C8: `POST /api/slack/events` route + mention flow

**Files:** Modify `src/server/app.ts`, `src/server/__tests__/slack-routes.test.ts`

- [ ] **Step 1: Imports** — add to `app.ts`: `import { extractMention, isUrlVerification } from "./slack/events"`; add `mergeBugReportSections` to the `./request-validation` import.

- [ ] **Step 2: Route** — add before `.mount(authHandler)`:
```ts
    .post("/slack/events", async ({ request }) => {
      const deps = getDependencies()
      if (!deps.slack || !deps.config.slack)
        return json({ error: "not_found" }, 404)
      const raw = await request.text()
      if (
        !verifySlackSignature({
          signingSecret: deps.config.slack.signingSecret,
          signature: request.headers.get("x-slack-signature"),
          timestamp: request.headers.get("x-slack-request-timestamp"),
          rawBody: raw,
          nowMs: Date.now(),
        })
      )
        return json({ error: "bad_signature" }, 401)

      const payload = JSON.parse(raw)
      if (isUrlVerification(payload)) return json({ challenge: payload.challenge })

      const mention = extractMention(payload)
      if (!mention) return new Response("", { status: 200 })
      if (await deps.repo.hasProcessedSlackEvent(mention.eventId))
        return new Response("", { status: 200 })
      await deps.repo.recordSlackEvent(mention.eventId)

      const slack = deps.slack
      const gemini = deps.gemini
      const baseUrl = deps.config.betterAuthUrl
      const work = (async () => {
        try {
          if (!gemini) {
            await slack.postMessage({
              channel: mention.channel,
              threadTs: mention.threadTs,
              text: ":information_source: AI drafting isn't enabled — use `/ticket` or the ⋯ \"Create LinearDesk ticket\" shortcut.",
            })
            return
          }
          const { messages } = await slack.getThreadReplies({
            channel: mention.channel,
            threadTs: mention.threadTs,
          })
          const draft = await gemini.extractTicketDraft(buildTranscript(messages))
          const description = mergeBugReportSections({
            expectedBehaviour: draft.expectedBehaviour,
            currentBehaviour: draft.currentBehaviour,
            stepsToReproduce: draft.stepsToReproduce,
          })
          const images = messages
            .flatMap((m) => m.files)
            .filter((f) => f.mimetype.startsWith("image/"))
          const result = await createSlackTicket(
            { config: deps.config, repo: deps.repo, linear: deps.linear, slack },
            {
              slackUserId: mention.user,
              title: draft.title.trim() || "Bug reported via Slack",
              description,
              severity: 3,
              channel: mention.channel,
              threadTs: mention.threadTs,
              files: images,
            }
          )
          const note =
            result.droppedImages > 0
              ? ` (couldn't attach ${result.droppedImages} image(s))`
              : ""
          await slack.postMessage({
            channel: mention.channel,
            threadTs: mention.threadTs,
            text: `:white_check_mark: Created *${result.issue.identifier}* from this thread${note}. Need to fix the details? ${baseUrl}/requests/${result.record.id}`,
          })
        } catch (error) {
          console.error("slack mention auto-create failed", error)
          const text =
            error instanceof SlackEmailMissingError
              ? ":warning: Your Slack account has no email, so I couldn't create a ticket."
              : `:x: Sorry — couldn't create a ticket from this thread: ${error instanceof Error ? error.message : "unknown error"}`
          await slack
            .postMessage({ channel: mention.channel, threadTs: mention.threadTs, text })
            .catch((e) => console.error("slack mention fallback postMessage failed", e))
        }
      })()
      scheduleBackground(request, work)
      return new Response("", { status: 200 })
    })
```

- [ ] **Step 3: Tests** in `slack-routes.test.ts` (configured app with slack + gemini; reuse `slackHeaders`, `makeGemini`, `makeSlack`, `makeRepo`, `makeLinear`):
```ts
function eventsBody(payloadObj: unknown) {
  return JSON.stringify(payloadObj)
}

it("echoes the url_verification challenge", async () => {
  const cfg = { ...config, slack: { signingSecret: "sign", botToken: "xoxb" } }
  const app = createApiApp({ config: cfg, repo: makeRepo(), linear: makeLinear(), slack: makeSlack(), auth: { getSession: vi.fn(async () => null) } })
  const raw = eventsBody({ type: "url_verification", challenge: "abc" })
  const res = await app.fetch(new Request("http://localhost/api/slack/events", { method: "POST", headers: slackHeaders("sign", raw), body: raw }))
  expect(res.status).toBe(200)
  await expect(res.json()).resolves.toEqual({ challenge: "abc" })
})

it("auto-creates a ticket on app_mention and confirms with a portal link", async () => {
  const slack = makeSlack()
  slack.getThreadReplies = vi.fn(async () => ({ messages: [{ user: "U1", text: "export 500s", files: [] }] }))
  const gemini = makeGemini()
  const repo = makeRepo()
  const cfg = { ...config, betterAuthUrl: "https://portal.example", slack: { signingSecret: "sign", botToken: "xoxb" }, gemini: { apiKey: "g", model: "gemini-3.5-flash" } }
  const app = createApiApp({ config: cfg, repo, linear: makeLinear(), slack, gemini, auth: { getSession: vi.fn(async () => null) } })
  const raw = eventsBody({ event_id: "Ev1", event: { type: "app_mention", user: "U1", channel: "C1", ts: "1.1" } })
  const res = await app.fetch(new Request("http://localhost/api/slack/events", { method: "POST", headers: slackHeaders("sign", raw), body: raw }))
  expect(res.status).toBe(200)
  await vi.waitFor(() => {
    expect(repo.createRequest).toHaveBeenCalled()
    expect(slack.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining("https://portal.example/requests/") })
    )
  })
})

it("ignores a duplicate event_id", async () => {
  const slack = makeSlack()
  const repo = makeRepo()
  repo.hasProcessedSlackEvent = vi.fn(async () => true)
  const cfg = { ...config, slack: { signingSecret: "sign", botToken: "xoxb" }, gemini: { apiKey: "g", model: "m" } }
  const app = createApiApp({ config: cfg, repo, linear: makeLinear(), slack, gemini: makeGemini(), auth: { getSession: vi.fn(async () => null) } })
  const raw = eventsBody({ event_id: "Ev1", event: { type: "app_mention", user: "U1", channel: "C1", ts: "1.1" } })
  await app.fetch(new Request("http://localhost/api/slack/events", { method: "POST", headers: slackHeaders("sign", raw), body: raw }))
  expect(repo.createRequest).not.toHaveBeenCalled()
})
```

- [ ] **Step 4: Verify** — `bun run format` then `bun run typecheck && bun run lint && bun run test` → all green.

- [ ] **Step 5: Commit**
```bash
git add src/server/app.ts src/server/__tests__/slack-routes.test.ts
git commit -m "feat(mention): /api/slack/events auto-create + portal link"
```

---

## Task C9: Docs + manifest

**Files:** Modify `README.md`, `docs/slack-app-manifest.md`

- [ ] **Step 1: Manifest** — add `app_mentions:read` to the bot scopes; add an `event_subscriptions` block with `request_url: https://lineardesk.vercel.app/api/slack/events` and `bot_events: [app_mention]`. Note the reinstall requirement.

- [ ] **Step 2: README** — in the Slack section: document that `@LinearDesk` in a thread auto-creates an AI-drafted ticket (with thread images) and replies with a portal link to edit it; the portal detail page now has an **Edit** button (owner, non-terminal). Note the new `app_mentions:read` scope (→ reinstall) and that Phase 2's `slack_events` migration must be applied to prod via `bun run db:migrate:prod` **before** deploying.

- [ ] **Step 3: Commit**
```bash
git add README.md docs/slack-app-manifest.md
git commit -m "docs(mention): app_mentions:read scope, events URL, README"
```

---

## Manual verification (post-merge, live)

1. Apply the `slack_events` migration to prod: `bun run db:migrate:prod`.
2. Slack app: add `app_mentions:read`, enable Event Subscriptions with request URL `…/api/slack/events` (Slack will hit it for url_verification — confirm it verifies), subscribe to `app_mention`; **reinstall**; update `SLACK_BOT_TOKEN` if rotated.
3. In a thread (with an image), `@LinearDesk` → confirm a ticket is created, the reply links to the portal, and the image is on the Linear issue.
4. Open the portal link → **Edit** → change a field → save → confirm Linear + the portal reflect it.
5. Temporarily unset `GEMINI_API_KEY` → `@LinearDesk` replies with the `/ticket`/shortcut hint instead of creating.

---

## Self-review

**Spec coverage:** Phase 1 edit endpoint + form (C1–C4) ✓; owner-scoped + terminal-rejected (C3) ✓; Linear updateIssue + DB (C1/C3) ✓; freeform description edit (C2) ✓. Phase 2 events route + dedup + bot-filter + url_verification (C6–C8) ✓; thread read + Gemini draft + **thread images** + createSlackTicket + portal-link confirmation (C8, C5) ✓; partial-draft tolerance + medium default + title fallback (C8) ✓; no-Gemini fallback (C8) ✓; new scope + migrate-before-deploy (C6/C9) ✓.

**Placeholder scan:** none. C4's UI references `@/components/ui/input` with a fallback instruction to match `new.tsx` if the path differs (the one spot needing the implementer to confirm an import path).

**Type consistency:** `updateIssueFields({issueId,title,description,priority})` (C1) called with `priority: input.severity` (C3). `updateRequestFields({id,title,description,severity})` (C1) called in C3. `parseUpdateRequestInput → CreateRequestInput {title,description,severity}` (C2) used in C3. `getThreadReplies` files (C5) consumed by `messages.flatMap(m => m.files)` (C8). `extractMention → {eventId,user,channel,threadTs}` (C7) used in C8. `createSlackTicket` args match the shipped service. `hasProcessedSlackEvent`/`recordSlackEvent` (C6) used in C8.

**Known risks:** the `slack_events` migration must reach prod before the Phase-2 deploy (flagged); the events URL + signature behavior is live-verified; C4's input component path is the one implementer-confirm point.
