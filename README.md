# LinearDesk

Minimal external helpdesk portal for Linear. Users authenticate with Google, submit support requests, and watch the current Linear status without needing Linear access.

> **Filing or tracking a request?** See the [User Guide](docs/USER_GUIDE.md) for how to use the portal and Slack intake. The rest of this README is for developers and operators.

## Stack

- TanStack Start with the requested shadcn starter preset.
- Elysia mounted under `src/routes/api.$.ts` at `/api`.
- Better Auth with Google OAuth and Postgres-backed sessions.
- Drizzle ORM with Postgres migrations.
- Linear server integration through `@linear/sdk`.

## Local Development

Copy `.env.example` to `.env.local` and fill in Google OAuth, Linear, and any email provider overrides.

```bash
docker compose up -d db
bun install
bun run db:migrate
bun run dev
```

The dev server runs on [http://localhost:3000](http://localhost:3000).
The local Postgres container is exposed on host port `5433` to avoid collisions with other local Postgres instances.

## Environment Contract

Required runtime variables:

- `DATABASE_URL`
- `BETTER_AUTH_SECRET`
- `BETTER_AUTH_URL`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `LINEAR_CLIENT_ID`
- `LINEAR_CLIENT_SECRET`
- `LINEAR_WEBHOOK_SECRET`

Email settings:

- `EMAIL_PROVIDER` — optional; defaults to `log`. Use `log` for local development or `resend` for production email.
- `EMAIL_FROM` — optional; defaults to `LinearDesk <noreply@lineardesk.local>`.
- `EMAIL_APP_NAME` — optional; defaults to `LinearDesk`.
- `RESEND_API_KEY` — used for magic links and organization invitations. A non-empty key implies Resend when `EMAIL_PROVIDER` is omitted; `EMAIL_PROVIDER=resend` requires this value.

Linear defaults:

- `LINEAR_TEAM_ID=87e7afa0-8d4c-4c43-86a5-090799f403b9` — default team in the web picker and the team used for Slack-created tickets. The web portal also lists the other active teams available to the Linear app.
- `LINEAR_TEAM_KEY=BAS`
- `LINEAR_INITIAL_STATE_NAME=Triage`
- `LINEAR_LABEL_NAME=Bug`

Linear authentication uses an OAuth application's client credentials, so
issues, comments, and edits are attributed to the app instead of the person
running LinearDesk. Enable the client-credentials grant for the app and allow
the `read` and `write` scopes.

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

Seed domains before first sign-in, magic-link attempt, or Slack intake for those
users.

The seed command also backfills existing tickets whose `requester_email` domain
matches the seeded domains. It prints any remaining unmapped requester emails;
map those before enforcing `helpdesk_requests.organization_id` as not null.

## API

- `GET /api/health`
- `GET /api/requests`
- `POST /api/requests`
- `GET /api/requests/:id`
- `POST /api/linear/webhook`
- `/api/auth/*` via Better Auth

## Deployment (Vercel + Neon)

LinearDesk deploys to [Vercel](https://vercel.com) with a serverless [Neon](https://neon.tech) Postgres database. The build switches to Nitro's Vercel preset automatically — Vercel sets `VERCEL=1`, which `vite.config.ts` uses to emit the Vercel Build Output (`.vercel/output`).

1. **Neon database** — create a project and copy two connection strings: the **pooled** URL (host contains `-pooler`) for the app runtime, and the **direct/unpooled** URL for migrations. `drizzle-kit migrate` fails through Neon's pooler (PgBouncer), so migrations must use the unpooled URL:

   ```bash
   # if DATABASE_URL_UNPOOLED is in your env (Neon/Vercel provide it):
   bun run db:migrate:prod

   # or pass the direct URL explicitly:
   DATABASE_URL='<neon-direct-url>' bun run db:migrate
   ```

2. **Vercel project** — import the repo. Vercel auto-detects Bun (`bun.lock`); the build command (`bun run build`) is pinned in `vercel.json`, and Nitro writes the Build Output to `.vercel/output`.

3. **Environment variables** (Vercel → Settings → Environment Variables):
   - `DATABASE_URL` — Neon **pooled** URL
   - `BETTER_AUTH_URL` — your deployed origin, e.g. `https://lineardesk.vercel.app`
   - `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
   - `RESEND_API_KEY` — enables Resend for magic links and organization invitations; `EMAIL_PROVIDER=resend` also requires it
   - `EMAIL_PROVIDER`, `EMAIL_FROM`, `EMAIL_APP_NAME` — optional email overrides; see the defaults above
   - `LINEAR_CLIENT_ID`, `LINEAR_CLIENT_SECRET`, `LINEAR_TEAM_ID`, `LINEAR_TEAM_KEY`, `LINEAR_INITIAL_STATE_NAME`, `LINEAR_LABEL_NAME`, `LINEAR_WEBHOOK_SECRET`
   - `CRON_SECRET` — a random string that secures the reconcile cron (Vercel sends it as a Bearer token)
   - `SLACK_SIGNING_SECRET` and `SLACK_BOT_TOKEN` — optional; omit to disable Slack intake
   - `GEMINI_API_KEY` — optional; enables AI pre-fill of the Slack ticket modal from the thread
   - `GEMINI_MODEL` — optional override; defaults to `gemini-3.5-flash`

   Production deployments need a transactional email provider. LinearDesk uses
   Resend through an internal adapter; no SMTP server is required.

4. **Google OAuth** — add `https://<your-domain>/api/auth/callback/google` to the authorized redirect URIs.

5. **Linear webhook** — point the webhook URL at `https://<your-domain>/api/linear/webhook` and subscribe it to both **Issue** and **Comment** resources. This keeps request statuses current and drives Slack notifications for Linear updates.

**Whenever the schema changes, apply the migration to prod _before or with_ the deploy that depends on it** — run `bun run db:migrate:prod`. The Vercel build does **not** run migrations, so shipping schema-dependent code ahead of its migration will 500 every query against the changed table until the migration lands.

### Status sync

The Linear webhook is the primary, near-real-time path for status updates and requester Slack notifications. Subscribe it to both **Issue** and **Comment** resources. As a safety net for missed webhook deliveries, a **daily Vercel cron** (`vercel.json` → `/api/cron/reconcile`, protected by `CRON_SECRET`) checks up to 200 non-terminal requests, oldest synchronization first, and corrects any that drifted. Every checked request advances through the scan, including unchanged or missing issues, so later runs reach the remaining tickets. Linear comments are fetched with their authors across all pages. Open detail views poll every 15 seconds and reuse completed prefetches for that interval.

### Slack intake (optional)

Set `SLACK_SIGNING_SECRET` and `SLACK_BOT_TOKEN` (in Vercel → Settings → Environment Variables for prod) to enable the Slack integration. When either variable is absent the `/api/slack/*` routes do not mount and the rest of the app is unaffected.

**Setup**

1. Create the Slack app from [`docs/slack-app-manifest.md`](docs/slack-app-manifest.md) — paste the manifest in [api.slack.com/apps](https://api.slack.com/apps) → "Create New App" → "From a manifest". Swap in your own domain where the manifest uses `lineardesk.vercel.app`. Install the app to your workspace and copy the signing secret and bot token into your environment.
2. In every Slack channel where the bot will be used, run `/invite @LinearDesk`. This is required so the bot can read message attachments and images when a user creates a ticket from a message.

**AI pre-fill (optional)**

With `GEMINI_API_KEY` set, the "Create LinearDesk ticket" message shortcut reads the thread within the limits below and uses Gemini Flash to draft the ticket Title, Expected Behaviour, Current Behaviour, Steps to Reproduce, and Severity. The user reviews and edits the draft before submitting. Without the key the shortcut opens the form with only the triggering message pre-filled into Current Behaviour. The `channels:history` scope (and `groups:history` for private channels) must be present in the app manifest for the thread read to work — adding these scopes requires **reinstalling** the app (see [`docs/slack-app-manifest.md`](docs/slack-app-manifest.md)).

**Usage**

- `/ticket` — opens a form to file a new ticket directly from Slack.
- "Create LinearDesk ticket" message shortcut (⋯ menu on any message) — pre-fills the form with the message text and any attached image, so the whole message becomes a ticket. With `GEMINI_API_KEY` set, thread text is read within the limits below and the form fields are drafted automatically.
- **`@LinearDesk` mention in a thread** — mentioning the bot in any thread immediately creates an AI-drafted ticket and replies in-thread with the inferred severity and a link to the portal edit page. Gemini drafts from message text; supported images from the included messages are attached to the Linear issue separately. If `GEMINI_API_KEY` is not set, the bot replies with a hint to use `/ticket` or the ⋯ "Create LinearDesk ticket" shortcut instead — it cannot auto-draft without Gemini. This requires the `app_mentions:read` scope and Event Subscriptions enabled in the Slack app (see [`docs/slack-app-manifest.md`](docs/slack-app-manifest.md)); adding the scope requires **reinstalling** the app.

Tickets created from any flow appear in the portal attributed to the Slack user's email (matched via `users:read.email`).

Thread drafting follows Slack cursors up to 200 messages, 60,000 text characters, or 20 pages. The modal or confirmation displays a notice when this budget truncates the thread. Requesters must belong to an approved organization before thread retrieval or paid AI drafting.

Slack deliveries are claimed atomically. Failures before Linear creation release the claim so a redelivery can retry. Once an external creation starts, interrupted or uncertain operations retain the claim to prevent duplicate issues; check Linear and reconcile the portal record before a manual retry. Failed confirmations do not retry ticket creation. Background work uses the serverless runtime lifetime hook when available and runs independently of acknowledgements on the persistent Bun server; it is not a durable job queue.

**Requester notifications**

Human-authored issue updates and comment changes in Linear notify the request
creator in Slack. Tickets created from Slack are updated in their originating
thread and mention the creator. Web-created tickets are delivered to the
creator's LinearDesk App Home conversation after matching the portal email with
`users.lookupByEmail`. The existing `chat:write` and `users:read.email` scopes
in the manifest cover both paths. Changes made by LinearDesk itself are skipped
so requesters are not notified about their own portal actions.

**Portal ticket editing**

The ticket detail page has an **Edit** button visible to approved users in the ticket's customer organization while the ticket is in a non-terminal state. It lets them change the Title, Description, and Severity, and attach more screenshots through the same drop/upload control used during request creation. The update is applied to both the Linear issue and the portal database.

Replies accept pasted, dropped, or selected screenshots. Because Linear stores uploaded files privately, the portal serves images through an authenticated request-scoped proxy using the server-side Linear token; the token is never exposed to the browser.

**Phase 2 deploy step — migrate before deploying**

Phase 2 adds a `slack_events` deduplication table. Apply the migration to prod **before** deploying this change:

```bash
bun run db:migrate:prod
```

Deploying without this migration will cause every `@mention` event to 500 until the table exists.

### Maintenance checks

`bun run test`, `bun run typecheck`, and `bun run lint` check the application. Database integration checks opt in with `LINEARDESK_TEST_DATABASE_URL`; the supplied PostgreSQL role must be allowed to create databases. These tests create, migrate, and drop a unique test database, leaving the supplied database intact:

```bash
LINEARDESK_TEST_DATABASE_URL='postgresql://test-user@localhost:5432/postgres' bun run test -- src/server/__tests__/repository-integration.test.ts
```

Migration `0007_maintenance_indexes.sql` replaces the organization-only index with one matching list order, adds an index for the rotating reconciliation scan, and removes the redundant issue-ID index while preserving its unique constraint. Apply it with the usual migration command; production migrations remain a separate deployment step.

The request-list API now accepts `page`, `pageSize` (1–100), `status` (`all`, `active`, `done`), and comma-separated `severity` values (1–4). It returns summary rows plus `total`, `page`, and `pageSize`; full descriptions and comments are available on the detail endpoint.

### Self-hosting (optional)

The `Dockerfile` still builds a standalone Bun server (Nitro `bun` preset) if you'd rather self-host than use Vercel:

```bash
docker build -t lineardesk .
```

It listens on port `3000` and exposes `/api/health` for readiness/liveness probes.

## License

LinearDesk is **source-available** under the [MIT License with the Commons Clause](LICENSE). You may use, modify, fork, and redistribute it freely — but you may **not sell** it, meaning you may not provide to third parties, for a fee, a product or service whose value derives substantially from this code (including paid hosting/SaaS). See [LICENSE](LICENSE) for the exact terms.

## Vercel runtime

Vercel Functions use Bun via `"bunVersion": "1.x"` in `vercel.json`.
This selects the Bun 1.3 track rather than the breaking Bun 1.4 migration.
Validate the preview deployment before merging; Bun on Vercel is in Beta.
