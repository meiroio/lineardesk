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

1. **Neon database** — create a project and copy two connection strings: the **pooled** URL (host contains `-pooler`) for the app runtime, and the **direct** URL for migrations. Apply the schema against the direct URL:

   ```bash
   DATABASE_URL='<neon-direct-url>' bun run db:migrate
   ```

2. **Vercel project** — import the repo. Vercel auto-detects Bun (`bun.lock`); the build command (`bun run build`) is pinned in `vercel.json`, and Nitro writes the Build Output to `.vercel/output`.

3. **Environment variables** (Vercel → Settings → Environment Variables):
   - `DATABASE_URL` — Neon **pooled** URL
   - `BETTER_AUTH_URL` — your deployed origin, e.g. `https://lineardesk.vercel.app`
   - `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ALLOWED_EMAIL_DOMAINS`
   - `LINEAR_API_KEY`, `LINEAR_TEAM_ID`, `LINEAR_TEAM_KEY`, `LINEAR_INITIAL_STATE_NAME`, `LINEAR_LABEL_NAME`, `LINEAR_WEBHOOK_SECRET`

4. **Google OAuth** — add `https://<your-domain>/api/auth/callback/google` to the authorized redirect URIs.

5. **Linear webhook** — point the webhook URL at `https://<your-domain>/api/linear/webhook`.

Re-run the migration command whenever the schema changes.

### Self-hosting (optional)

The `Dockerfile` still builds a standalone Bun server (Nitro `bun` preset) if you'd rather self-host than use Vercel:

```bash
docker build -t lineardesk .
```

It listens on port `3000` and exposes `/api/health` for readiness/liveness probes.

## License

LinearDesk is **source-available** under the [MIT License with the Commons Clause](LICENSE). You may use, modify, fork, and redistribute it freely — but you may **not sell** it, meaning you may not provide to third parties, for a fee, a product or service whose value derives substantially from this code (including paid hosting/SaaS). See [LICENSE](LICENSE) for the exact terms.
