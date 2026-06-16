# @mention auto-create + portal self-edit — Design

- **Date:** 2026-06-13
- **Status:** Approved in brainstorming; pending implementation plan
- **Author:** Adam Sobotka (with Claude)

## Goal

Two UX improvements to Slack intake, built as two independent phases:

1. **Portal field editing** — let the ticket owner edit Title / Description /
   Severity of their own (non-terminal) ticket from the LinearDesk portal.
   Useful for any ticket, web- or Slack-created.
2. **`@mention` auto-create** — `@LinearDesk` in a Slack thread immediately
   creates an AI-drafted ticket (from the whole thread) and posts a
   confirmation that links to the portal edit page. This replaces the clunky
   `⋯` message-shortcut as the primary trigger. "Fast, then fix it if the AI
   got it wrong."

Phase 1 ships first — Phase 2's confirmation links to it.

## Context (already shipped)

- Slack intake: `⋯` shortcut / `/ticket` → 3-part modal → `createSlackTicket`
  (Linear issue + `helpdesk_requests` row + the triggering message's images +
  a thread permalink, attributed by email). AI pre-fill via Gemini on the
  shortcut. `SlackGateway`: `openView`/`updateView`/`postMessage`/
  `getUserEmail`/`getPermalink`/`getThreadReplies`/`downloadFile`.
  `GeminiGateway.extractTicketDraft` + `buildTranscript`. Web validator
  `parseCreateRequestInput` (3-part → merged description).
- Portal detail page (`src/routes/requests/$requestId.tsx`): React Query;
  shows the request + comments; reply + close; **no field editing**. Lists/gets
  scoped by session email.
- `linear_webhook_events` table + `hasProcessedWebhookEvent`/
  `recordWebhookEvent` are the existing event-dedup pattern to mirror.

## Phase 1 — Portal field editing

The owner edits their own non-terminal ticket's Title / Description / Severity.

- **Frontend** (`$requestId.tsx` + a small edit-form component): an **Edit**
  button (shown when the request isn't terminal — reuse `isDoneStatus`)
  toggles a form: Title (input), Description (multiline textarea, prefilled
  with the current `description`), Severity (select). Submit → a new client
  `updateRequest(id, {...})` → React Query `setQueryData` + invalidate.
- **API** (`app.ts`): `POST /api/requests/:id/update` —
  `requireAuthorizedSession`; `getRequestForEmail(id, session.user.email)`
  (404 if not the owner / not found); reject if terminal
  (`isDoneStatus` → 409); validate; `linear.updateIssueFields(...)`;
  `repo.updateRequestFields(...)`; return the serialized request.
- **Validation** (`request-validation.ts`): `parseUpdateRequestInput` →
  `{ title, description, severity }` (title 3–160; description 1–8000; severity
  label → priority via the existing `SEVERITY_PRIORITY`). Description is
  freeform here (edited as-is — **not** re-split into three fields). Field-keyed
  errors like `parseCreateRequestInput`.
- **LinearGateway** (`types.ts` + `linear.ts`):
  `updateIssueFields({ issueId, title, description, priority }) => Promise<void>`
  → `client.updateIssue(issueId, { title, description, priority })`.
- **Repository**: `updateRequestFields({ id, title, description, severity }) =>
  Promise<RequestRecord>` → updates `helpdesk_requests`
  (title/description/severity/updatedAt) by id, returns the row.
- **Client** (`helpdesk-api.ts`): `updateRequest(id, input)` POSTing to the new
  endpoint.
- No schema change.

## Phase 2 — Slack `@mention` auto-create

- **Events API**: new bot scope `app_mentions:read`; a new route
  `POST /api/slack/events` that:
  - handles Slack's `url_verification` (echo the `challenge`);
  - verifies the Slack signature (reuse `verifySlackSignature`);
  - **dedups by `event_id`** (skip if already processed);
  - ignores messages from bots / the app itself (no loops);
  - for `app_mention`, **acks 200 immediately** and runs the work via
    `scheduleBackground`.
- **Flow** (background): derive `channel` + thread root
  (`event.thread_ts ?? event.ts`); `getThreadReplies`; if Gemini is configured →
  `extractTicketDraft(buildTranscript(messages))` → merge the draft's three
  fields via `mergeBugReportSections` → `createSlackTicket({ slackUserId:
  event.user, title, description, severity: <default "medium">, channel,
  threadTs, files: <image files gathered from the thread> })` → post in-thread:
  *":white_check_mark: Created <identifier> from this thread. Need to fix the
  details? <portal edit URL>"*.
  - **Portal URL**: `${config.betterAuthUrl}/requests/${record.id}`.
  - **Images (required)**: `getThreadReplies` is extended to return each
    message's `files` (`{ id, name, mimetype, url_private }` → `SlackFileRef`).
    The flow collects image files across the whole thread and passes them as
    `files`; `createSlackTicket`'s existing pipeline downloads them (bot token,
    `files:read`) and uploads to Linear, embedding them in the description.
    (The `⋯` shortcut keeps its current single-message image behavior.)
  - **Title/Severity/partial drafts**: `createSlackTicket` needs a non-empty
    title and a numeric severity. Use `draft.title` or, if the model returned
    none, a fallback like "Bug reported via Slack"; default severity to
    **medium (priority 3)** (no picker in the mention flow). `mergeBugReportSections`
    tolerates empty sections, so a **partial draft still creates** — auto-create
    must never fail on a thin draft; the requester fixes it via the Phase-1
    portal edit. (Note: this path does NOT use the strict `parseCreateRequestInput`,
    which would reject empty sections.)
  - **No Gemini** (`!deps.gemini`): reply in-thread pointing to `/ticket` or the
    `⋯` shortcut (can't auto-draft without it).
  - **Failure**: reply in-thread with a short error (mirror the
    `createSlackTicket` fallback messaging); dedup prevents retry double-creates.
- **Dedup store**: new `slack_events(event_id text primary key, received_at
  timestamptz not null default now())` + repo `hasProcessedSlackEvent(eventId)`
  / `recordSlackEvent(eventId)` — mirrors `linear_webhook_events`. **Migration**
  → run `bun run db:migrate:prod` against prod **before** deploying Phase 2.
- New scope → **reinstall** the Slack app (token may rotate → update
  `SLACK_BOT_TOKEN`).

### Images (required)
Image attach is a fundamental requirement, so the mention flow gathers images
from the whole thread (see Flow above): `getThreadReplies` returns each
message's `files`, and `createSlackTicket`'s existing image pipeline handles
download + upload + embed. Uses the `files:read` scope already in the manifest.
Note this slightly extends `getThreadReplies`' return shape (a `files` array per
message); the existing shortcut-AI caller ignores it, so the change is
backward-compatible.

## Components / files

- **Create:** `src/server/slack/events.ts` (parse/verify/dedup helpers for the
  events route, pure where possible) + test; a portal edit-form component +
  test; the `slack_events` migration.
- **Modify:** `types.ts` (`updateIssueFields` on `LinearGateway`; repo methods),
  `linear.ts`, `repository.ts`, `request-validation.ts`
  (`parseUpdateRequestInput`), `app.ts` (`/api/requests/:id/update` +
  `/api/slack/events`), `slack/gateway.ts` + `types.ts` (`getThreadReplies`
  returns per-message `files`), `db/schema.ts` (`slack_events`),
  `src/lib/helpdesk-api.ts` (`updateRequest`), `$requestId.tsx` (edit UI),
  `.env.example`/`README`/`docs/slack-app-manifest.md` (scope + Events URL).

## Data model

- Phase 1: none.
- Phase 2: `slack_events` dedup table (migration; migrate prod before deploy).

## Error handling

- Events route: signature verified before any handling; `url_verification`
  echoed; dedup; bot/self ignored.
- Mention background work: Gemini/thread/create failure → in-thread error reply.
- Portal edit: validation → field errors; not owner → 404; terminal → 409;
  Linear/DB failure → 500 and the form surfaces it. Update Linear first, then
  the DB — if Linear fails, the DB row is left unchanged.

## Security

- Events route signature-verified + dedup'd + bot/self-filtered.
- Portal edit owner-scoped (by verified session email) and non-terminal only.

## Testing

- Phase 1: update endpoint (owner / terminal-rejected / validation /
  `updateIssueFields` + `updateRequestFields` called); the gateway + repo
  methods; the client `updateRequest`.
- Phase 2: events route (`url_verification` challenge echoed; bad signature →
  401; duplicate `event_id` → no-op; `app_mention` → `createSlackTicket` called
  + confirmation posted with the portal URL; thread images passed through to
  `createSlackTicket`; no-Gemini → fallback reply; bot message ignored). Pure
  helpers in `events.ts` unit-tested; the HTTP edges live-verified.

## Out of scope (YAGNI)

- Editing the three bug sections separately in the portal (one Description box).
- Conversational back-and-forth; bidirectional Slack↔Linear sync (Plan B).

## Risks

- `app_mention` dedup correctness (event-id store + ack-fast/background).
- Linear ↔ DB consistency on portal edit (Linear first, then DB).
- Slack Events URL-verification + signature handling on the new route.
- Mention-without-Gemini UX (the fallback reply).
