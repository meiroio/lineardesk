# LinearDesk

Minimal external helpdesk portal for Linear. Users authenticate with Google, submit support requests, and watch the current Linear status without needing Linear access.

## Stack

- TanStack Start with the requested shadcn starter preset.
- Elysia mounted under `src/routes/api.$.ts` at `/api`.
- Better Auth with Google OAuth and Postgres-backed sessions.
- Drizzle ORM with Postgres migrations.
- Linear server integration through `@linear/sdk`.

## Local Development

Copy `.env.example` to `.env.local` and fill in Google OAuth, Linear, and allowed domain values.

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
- `ALLOWED_EMAIL_DOMAINS`
- `LINEAR_API_KEY`
- `LINEAR_WEBHOOK_SECRET`

Linear defaults:

- `LINEAR_TEAM_ID=87e7afa0-8d4c-4c43-86a5-090799f403b9`
- `LINEAR_TEAM_KEY=BAS`
- `LINEAR_INITIAL_STATE_NAME=Triage`
- `LINEAR_LABEL_NAME=Bug`

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
   - `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ALLOWED_EMAIL_DOMAINS`
   - `LINEAR_API_KEY`, `LINEAR_TEAM_ID`, `LINEAR_TEAM_KEY`, `LINEAR_INITIAL_STATE_NAME`, `LINEAR_LABEL_NAME`, `LINEAR_WEBHOOK_SECRET`
   - `CRON_SECRET` — a random string that secures the reconcile cron (Vercel sends it as a Bearer token)
   - `SLACK_SIGNING_SECRET` and `SLACK_BOT_TOKEN` — optional; omit to disable Slack intake
   - `GEMINI_API_KEY` — optional; enables AI pre-fill of the Slack ticket modal from the thread
   - `GEMINI_MODEL` — optional override; defaults to `gemini-3.5-flash`

4. **Google OAuth** — add `https://<your-domain>/api/auth/callback/google` to the authorized redirect URIs.

5. **Linear webhook** — point the webhook URL at `https://<your-domain>/api/linear/webhook`. This keeps request statuses current in near-real-time.

**Whenever the schema changes, apply the migration to prod _before or with_ the deploy that depends on it** — run `bun run db:migrate:prod`. The Vercel build does **not** run migrations, so shipping schema-dependent code ahead of its migration will 500 every query against the changed table until the migration lands.

### Status sync

The Linear webhook is the primary, near-real-time path for status updates. As a safety net for missed webhook deliveries, a **daily Vercel cron** (`vercel.json` → `/api/cron/reconcile`, protected by `CRON_SECRET`) pulls the current Linear state for every non-terminal request and corrects any that drifted. Comments are always read live from Linear, so they never go stale.

### Slack intake (optional)

Set `SLACK_SIGNING_SECRET` and `SLACK_BOT_TOKEN` (in Vercel → Settings → Environment Variables for prod) to enable the Slack integration. When either variable is absent the `/api/slack/*` routes do not mount and the rest of the app is unaffected.

**Setup**

1. Create the Slack app from [`docs/slack-app-manifest.md`](docs/slack-app-manifest.md) — paste the manifest in [api.slack.com/apps](https://api.slack.com/apps) → "Create New App" → "From a manifest". Swap in your own domain where the manifest uses `lineardesk.vercel.app`. Install the app to your workspace and copy the signing secret and bot token into your environment.
2. In every Slack channel where the bot will be used, run `/invite @LinearDesk`. This is required so the bot can read message attachments and images when a user creates a ticket from a message.

**AI pre-fill (optional)**

With `GEMINI_API_KEY` set, the "Create LinearDesk ticket" message shortcut reads the **whole thread** and uses Gemini Flash to draft the ticket Title, Expected Behaviour, Current Behaviour, and Steps to Reproduce. The user reviews and edits the draft, picks severity, and submits. Without the key the shortcut opens the form with only the triggering message pre-filled into Current Behaviour. The `channels:history` scope (and `groups:history` for private channels) must be present in the app manifest for the thread read to work — adding these scopes requires **reinstalling** the app (see [`docs/slack-app-manifest.md`](docs/slack-app-manifest.md)).

**Usage**

- `/ticket` — opens a form to file a new ticket directly from Slack.
- "Create LinearDesk ticket" message shortcut (⋯ menu on any message) — pre-fills the form with the message text and any attached image, so the whole message becomes a ticket. With `GEMINI_API_KEY` set, the entire thread is read and the form fields are drafted automatically.

Tickets created from either flow appear in the portal attributed to the Slack user's email (matched via `users:read.email`).

**Planned follow-up (Plan B)**

Status and comment updates flowing back into the originating Slack thread are not yet implemented.

### Self-hosting (optional)

The `Dockerfile` still builds a standalone Bun server (Nitro `bun` preset) if you'd rather self-host than use Vercel:

```bash
docker build -t lineardesk .
```

It listens on port `3000` and exposes `/api/health` for readiness/liveness probes.

## License

LinearDesk is **source-available** under the [MIT License with the Commons Clause](LICENSE). You may use, modify, fork, and redistribute it freely — but you may **not sell** it, meaning you may not provide to third parties, for a fee, a product or service whose value derives substantially from this code (including paid hosting/SaaS). See [LICENSE](LICENSE) for the exact terms.
