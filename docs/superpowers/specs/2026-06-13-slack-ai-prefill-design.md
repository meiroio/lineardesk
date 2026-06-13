# AI-assisted Slack intake (Option A) — Design

- **Date:** 2026-06-13
- **Status:** Approved in brainstorming; pending implementation plan
- **Author:** Adam Sobotka (with Claude)

## Goal

Slack bug reports often don't follow the required format. When a ticket is
created from a Slack message shortcut, read the **whole thread**, use **Gemini
Flash** to draft the structured fields (Title + Expected/Current/Steps), and
**pre-fill the ticket modal**. The human reviews, picks severity, and submits —
so AI mistakes are always caught (human-in-the-loop). This is "Option A" from
the feasibility discussion; the fully conversational agent ("Option B") is out
of scope.

## Context (current state, already shipped)

- Slack intake: message shortcut / `/ticket` → modal → `createSlackTicket` →
  Linear issue + `helpdesk_requests` row. Thread permalink added via
  `chat.getPermalink`; the triggering message's image(s) uploaded to Linear via
  `uploadAsset`.
- `SlackGateway` (`src/server/slack/gateway.ts`): `openView` (JSON write),
  `postMessage` (JSON write), `getUserEmail` + `getPermalink` (query-param read
  via `callGet`), `downloadFile`.
- The current Slack modal is "lighter" (Title + single Description + Severity).
  The **web** form is 3-part (Expected/Current/Steps) via
  `parseCreateRequestInput` + `mergeBugReportSections`.

## Locked decisions

| Area | Decision |
| --- | --- |
| Modal | The Slack modal becomes the **structured 3-part form** (Title · Expected behaviour · Current behaviour · Steps to reproduce · Severity), matching the web form. **Supersedes** the earlier lighter-modal decision — AI now fills the structure, so the friction that justified "lighter" is gone. |
| AI fills | **Title + the three text fields.** Severity stays **user-picked**. All AI output is an editable pre-fill the user reviews. |
| UX | Shortcut → **instant loading modal** → background (fetch thread + Gemini) → `views.update` to the pre-filled form → user picks severity, edits, submits. |
| Thread | **Whole thread** via `conversations.replies` → plain-text transcript → Gemini. Needs new Slack scope `channels:history` (+ `groups:history`) → **app reinstall**. |
| Images | **Unchanged** — only the triggering message's image(s). The AI step is text-only. |
| Gemini | Behind a `GeminiGateway` interface; **structured output** (`responseSchema`); `GEMINI_API_KEY` + model, **optional/feature-gated** (no key → modal opens empty). Paid key (no-train tier). |
| Reuse | `view_submission` reuses the web form's `parseCreateRequestInput` + `mergeBugReportSections`. Slack and web tickets become **structurally identical**. The bespoke `parseSlackTicketInput` is retired. |
| Failure | Any failure (no key / fetch error / Gemini error/timeout / malformed JSON) → `views.update` to the **empty** form. **Never blocks ticket creation.** |

## Flow

```
⋯ → Create LinearDesk ticket
  → if Gemini configured: open a LOADING modal ("✨ Drafting from the thread…",
      no input fields, no submit button) and capture its view_id   [instant]
    else: open the 3-part form directly (today's behavior, empty)
  → background (after the 200 ack, via scheduleBackground):
      conversations.replies(channel, thread_ts) → transcript
      gemini.extractTicketDraft(transcript) → { title, expected, current, steps }
      views.update(view_id, <3-part form pre-filled with those values>)
    on ANY error or timeout → views.update(view_id, <empty 3-part form>)
  → user picks Severity, edits anything, submits (view_submission)
  → parseCreateRequestInput(5 fields) → { title, description(merged), severity }
  → createSlackTicket(...)  [unchanged: requester email, images, thread link]
```

A loading view with **no inputs** means the AI result can't overwrite anything
the user already typed. If the user closes the loading modal early, the
`views.update` simply fails and is ignored.

## Components

- **`SlackGateway`** (`src/server/slack/gateway.ts`):
  - `openView` returns the created `view_id` (needed for `views.update`).
  - add `updateView(viewId, view)` → `views.update` (JSON write method).
  - add `getThreadReplies(channel, threadTs)` → `{ messages: { user, text }[] }`
    via `conversations.replies` (query-param read — use `callGet`).
- **`GeminiGateway`** (new, e.g. `src/server/ai/gemini.ts`):
  `extractTicketDraft(transcript: string)` →
  `{ title, expectedBehaviour, currentBehaviour, stepsToReproduce }`, using
  Gemini structured output (`responseSchema`). Thin HTTP/SDK adapter behind an
  interface so it's mockable and provider-swappable. Exact SDK/model/endpoint
  pinned during planning.
- **Config** (`config.ts` + `types.ts`): optional `gemini?: { apiKey; model }`;
  enabled only when `GEMINI_API_KEY` is set (default model is a Gemini Flash
  variant, overridable via env).
- **Modal** (`src/server/slack/modal.ts`):
  - `buildLoadingModal(privateMetadata)` → minimal view (context block, no
    inputs).
  - `buildTicketModal({ prefill?, privateMetadata })` → **3-part** form (Title,
    Expected, Current, Steps, Severity), each text field `initial_value` from
    `prefill` when present.
  - `parseTicketSubmission` → `{ slackUserId, title, expectedBehaviour,
    currentBehaviour, stepsToReproduce, severityLabel, meta }`.
- **Route `message_action`** (`app.ts`): open loading view (or the form
  directly when Gemini is off); background fetch → extract → `updateView`; all
  failures fall back to the empty form.
- **Route `/slack/commands` (`/ticket`)**: opens the 3-part form **directly
  and empty** — AI pre-fill is shortcut-only, since a slash command has no
  source thread to read.
- **Route `view_submission`**: parse 5 fields → `parseCreateRequestInput` (the
  web validator: 3-part required + merge) → `createSlackTicket` (unchanged
  signature). On validation error → `response_action: errors` (per field).
- Retire `parseSlackTicketInput`.

## Data model

No schema changes. `source` / `slack_channel_id` / `slack_message_ts` already
exist.

## Config & scopes

- New optional env: `GEMINI_API_KEY`, optional `GEMINI_MODEL`. Document in
  `.env.example`, README, and the Vercel env list. Feature-gated like Slack.
- New Slack scope `channels:history` (+ `groups:history` for private channels):
  update `docs/slack-app-manifest.md`; the app must be **reinstalled** and the
  bot token refreshed.

## Error handling

- Gemini disabled (no key) → open the 3-part form directly (no loading view).
- Thread fetch / Gemini error / timeout (bounded, e.g. ~10s) / invalid JSON →
  `views.update` to the empty form; `console.error` the cause (we already log
  Slack-side failures). Ticket creation is never blocked.
- `view_submission` missing/short field → `response_action: errors` per field —
  this is the "ask if unclear" surface (the modal enforces the format).

## Security / privacy

- Thread text is sent to Gemini via the **paid key** (no-train tier, approved).
  Key in env, never logged.
- Thread content is untrusted (prompt-injection): the model output is only a
  pre-fill the human reviews and the modal validates, so blast radius is low.
  The extraction prompt is scoped to "extract these fields" and instructed to
  treat the transcript as data, not instructions.

## Testing

- `GeminiGateway`: the transcript-building + prompt/schema construction are
  unit-tested; the HTTP/SDK call is a thin adapter verified live.
- `getThreadReplies`: thin adapter (live-verified); transcript assembly is
  unit-tested.
- Modal: `buildLoadingModal`, `buildTicketModal` (with/without prefill),
  `parseTicketSubmission` (5 fields) — unit tests.
- Route: `message_action` happy path (mock Gemini + Slack: loading → update
  with prefill), Gemini-disabled (form opens directly), Gemini-error (update to
  empty form). `view_submission` 3-part submission through
  `parseCreateRequestInput` → create.
- Live spike: real `conversations.replies` + Gemini draft on a real workspace.

## Out of scope (YAGNI)

- The conversational back-and-forth agent (Option B / Linear Asks Agent
  territory).
- Collecting images from the whole thread (kept to the triggering message).
- AI-suggested severity.
- A second AI provider (the interface allows it; only Gemini is implemented).

## Risks

- **`views.update` overwrite** — mitigated by the input-less loading view.
- **3-second `trigger_id` limit** — the loading view opens instantly, with no
  AI dependency on the critical path.
- **Gemini latency/cost** per ticket — Flash is fast/cheap; the call is bounded
  by a timeout that falls back to the empty form.
- **Exact Gemini SDK / model / structured-output API** — confirmed during
  planning (the `GeminiGateway` adapter is the only place it lives).
