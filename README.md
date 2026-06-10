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

If requests were created before Linear details comments were tracked, run this after migrations:

```bash
bun run backfill:linear-comments
```

The backfill command finds requests missing a stored Linear details comment id, creates the comment if needed, and stores the comment id. It uses a marker in the comment body to avoid creating duplicates.

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

## Deployment Shape

This repo provides an app container and health endpoint for Kubernetes. Production Postgres, Kubernetes manifests, ingress, TLS, and secrets are intentionally left to DevOps.

Build the app image:

```bash
docker build -t lineardesk .
```

The container listens on port `3000` and exposes `/api/health` for readiness/liveness probes.
