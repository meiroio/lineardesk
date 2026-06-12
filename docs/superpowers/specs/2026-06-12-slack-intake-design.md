# Slack intake for LinearDesk — Design

- **Date:** 2026-06-12
- **Status:** Approved in brainstorming; pending implementation plan
- **Author:** Adam Sobotka (with Claude)

## Goal

Let support people turn a Slack discussion — typically one that includes a
screenshot — into a LinearDesk bug, **without a Linear account**, such that:

1. The ticket is created in Linear (same team/labels as web requests).
2. The ticket is **visible in the LinearDesk portal** alongside web requests.
3. Status changes and comments flow **back to the originating Slack thread**.
4. Any image in the Slack message ends up on the Linear issue.

## Context (what already exists)

- Web portal: Google OAuth (Better Auth), structured bug form (Expected /
  Current / Steps + severity) → `createHelpdeskIssue` + `repo.createRequest`
  create the Linear issue and a `helpdesk_requests` row.
- Status is mirrored from Linear by a signed webhook (`/api/linear/webhook`)
  plus a daily reconcile cron. Comments are read live from Linear.
- Image paste on the web already uploads to Linear via the Linear gateway's
  `uploadAsset`, embedding a markdown image in the description.
- Server-side request composition/validation lives in
  `parseCreateRequestInput` / `mergeBugReportSections`
  (`src/server/request-validation.ts`) and is reused, not duplicated.

## Locked decisions

| Area | Decision |
| --- | --- |
| Architecture | **Option B** — our app creates the issue via the Linear API; updates ride **Linear's native Slack thread-sync** (`attachmentLinkSlack`), with our existing webhook as a fallback. |
| Primary trigger | **Message shortcut** (`⋯ → Create LinearDesk ticket`) — carries `trigger_id` (opens a modal) and the message's text + files. |
| Secondary trigger | `/ticket` slash command for a blank ticket (same modal). |
| Modal | **Lighter**: Title + Description (pre-filled from the message) + Severity. The strict 3-part format stays **web-only**. |
| Images | **In scope.** Download Slack files with the bot token → `uploadAsset` → embed markdown in the description (the existing web path). |
| Identity | Attribute by the submitter's Slack email. **Reject only if the Slack account has no email.** No `ALLOWED_EMAIL_DOMAINS` gate (internal Slack). |
| Portal visibility | List a user's requests **by verified email** rather than user id, so Slack tickets appear even before that person logs into the web app. |
| Optionality | Slack is **optional**: enabled only when `SLACK_*` env vars are set; otherwise the routes don't mount and nothing changes. |
| Workspace | **Single** company Slack workspace; bot token in env (like `LINEAR_API_KEY`). No OAuth distribution. |

## Why message shortcut, not @mention

`@mention` (app_mention) provides **no `trigger_id`**, so it cannot open a
modal — it forces freeform parsing and extra history calls to find the image.
A message shortcut provides `trigger_id` **and** the target message (text +
`files[]`), and lets us anchor the synced thread to the original discussion.

## Flow

### Intake

```
Message ⋯ → "Create LinearDesk ticket"   (or  /ticket)
  → Slack POST /api/slack/interactivity (shortcut)  [verify Slack signature]
  → views.open (within 3s): modal { Title, Description(prefill), Severity }
       private_metadata = { channel, message_ts, thread_ts, file_refs[] }
  → user submits
  → Slack POST /api/slack/interactivity (view_submission) [verify signature]
  → validate → ACK 200 immediately (Slack's 3s limit), then async:
       • download message images (bot token) → uploadAsset → markdown
       • description = freeform body + image markdown
       • resolve requester: users.info → email (reject if none)
       • createHelpdeskIssue + createRequest   [REUSED]
       • chat.postMessage confirmation as a reply in the source thread
       • persist { source:'slack', slackChannelId, slackMessageTs }
       • attachmentLinkSlack(issueId, permalink, syncToCommentThread:true)
```

`/ticket` is the same modal with no prefill; it may include a Slack
`file_input` block so a screenshot can be attached directly.

### Updates back to Slack

- **Primary:** Linear's native sync owns the thread once `attachmentLinkSlack`
  links it — requester replies become issue comments, and Linear comments +
  terminal status post back to the thread. No code from us.
- **Fallback (only if the spike below fails):** the existing Linear webhook
  posts status changes to the stored thread; extend it to handle `Comment`
  events (currently ignored); add a Slack `message` event subscription for
  inbound replies → `createIssueComment`, with a provenance guard against echo
  loops. More code and scopes; documented but not built unless needed.

## Components

- **`slack-signature.ts`** — verify `v0:{ts}:{rawBody}` HMAC-SHA256 against
  `SLACK_SIGNING_SECRET`, ±5-min window. Mirrors the Linear webhook verifier.
- **`SlackGateway`** — thin wrapper over the Slack Web API + a
  `verifyRequest`-style seam for tests: `openView`, `postMessage`,
  `getPermalink`, `getUserEmail` (`users.info`), `downloadFile`. Created only
  when Slack is configured.
- **Slack routes** (Elysia, mounted only when enabled):
  - `POST /api/slack/interactivity` — handles both the shortcut payload
    (`type: "message_action"` → open modal) and `view_submission` (→ create).
  - `POST /api/slack/commands` — `/ticket` → open modal.
  - `POST /api/slack/events` — **fallback only**, inbound replies.
- **Identity resolution** — `users.info` → email; reject if absent; resolve
  `requesterUserId` from an existing Better Auth user by email (else null).
- **Reused** — `createHelpdeskIssue`, `createRequest`, `uploadAsset`. The
  web-only `parseCreateRequestInput`/`mergeBugReportSections` are untouched; a
  small `parseSlackTicketInput` validates Title + Description + Severity.

## Data model

Migration on `helpdesk_requests`:

- add `source` `text not null default 'web'` (`'web' | 'slack'`)
- add `slack_channel_id` `text null`
- add `slack_message_ts` `text null`  (the synced thread root)
- make `requester_user_id` **nullable**

`repo.listRequestsForUser` keys on **email** instead of user id; the
`/api/requests` route passes `session.user.email`. Existing rows already store
`requester_email`, so no data backfill is required.

## Image handling details

- The shortcut payload carries `message.files[]` with `url_private`.
- On modal open we stash compact file references in `private_metadata` (cap a
  few; if a message has more, fall back to re-reading the message via
  `conversations.history`, which needs a history scope — out of MVP scope).
- On submit (async, after the 200 ACK) we download each file with
  `Authorization: Bearer ${SLACK_BOT_TOKEN}` (`files:read`), pass bytes to
  `uploadAsset`, and append `![name](assetUrl)` to the description.
- Failure to fetch/upload an image must **not** fail the ticket: create it
  anyway and note the dropped image in the confirmation reply.
- Constraint: the bot must be a member of the channel to read its files
  (public: trivial; private: `/invite @LinearDesk`).

## Security

- Every `/api/slack/*` route verifies the Slack signature **before** acting.
  This proves the POST is from Slack — not user-level gating — and stays even
  though the email-domain gate was dropped.
- Bot token lives in env; never logged.

## Configuration

- New, **optional**: `SLACK_SIGNING_SECRET`, `SLACK_BOT_TOKEN`.
- Slack is enabled iff both are present. When disabled, the Slack routes are
  not mounted and the Slack gateway is not constructed.
- Slack app manifest (committed for reference): message shortcut + `/ticket`
  command, interactivity + command request URLs, scopes `commands`,
  `chat:write`, `users:read.email`, `files:read`.
- Document in `.env.example`, `README`, and the Vercel env list.

## Error handling

- Modal validation errors → Slack `response_action: { errors }` (per-field),
  returned synchronously.
- Long work (image upload + Linear calls) runs **after** the 3s submission
  ACK; the confirmation reply is posted when done (or an error reply if
  creation failed).
- `users.info` without an email → ephemeral "your Slack account has no email"
  reply, no ticket.

## Testing

Unit tests in the existing mock style (Slack gateway + Linear gateway + repo
all faked):

- signature verification: valid / tampered / stale timestamp
- shortcut payload → modal open args (prefill + `private_metadata`)
- `view_submission` → `parseSlackTicketInput` → create wiring
- requester resolution: email present → attributed; absent → rejected
- image path: file refs → `uploadAsset` called → markdown embedded; upload
  failure still creates the ticket
- feature gating: routes absent when env unset

Plus a local Slack-signing helper script (sibling to
`scripts/send-test-webhook.ts`) for manual end-to-end checks.

## Risk / required spike

`attachmentLinkSlack(syncToCommentThread: true)` is documented as available
over the API, but its availability/behavior **below the Business tier is
unverified**. Implement an early spike: connect the standard Slack integration,
create a test issue, link a real thread, and confirm bidirectional sync. If it
fails, switch the update path to the webhook fallback above — the intake half
and most code are unchanged either way.

## Out of scope (YAGNI)

- Multi-workspace OAuth distribution.
- Whole-thread history scraping (we anchor to the discussion thread instead).
- `@mention` and the `@mention → button → modal` variant.
- Forcing the strict 3-part bug format in Slack.
- Inbound comment relay / Slack event subscription unless the spike fails.
