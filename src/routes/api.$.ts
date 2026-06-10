import { createFileRoute } from "@tanstack/react-router"

import { createApiApp } from "@/server/app"

const app = createApiApp()
const handle = ({ request }: { request: Request }) => app.fetch(request)

export const Route = createFileRoute("/api/$")({
  server: {
    handlers: {
      DELETE: handle,
      GET: handle,
      OPTIONS: handle,
      PATCH: handle,
      POST: handle,
      PUT: handle,
    },
  },
})
