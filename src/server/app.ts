import { Elysia } from "elysia"

import { createCronApi } from "./api/cron"
import {
  createDefaultDependencies,
  withDefaultWebhookVerifier,
} from "./api/dependencies"
import type {
  ApiDependencies,
  ResolvedApiDependencies,
} from "./api/dependencies"
import { createHealthApi } from "./api/health"
import { json } from "./api/http"
import { createLinearWebhooksApi } from "./api/linear-webhooks"
import { createRequestsApi } from "./api/requests"
import { createSlackApi } from "./api/slack"
import { createUploadsApi } from "./api/uploads"

export type { ApiDependencies } from "./api/dependencies"

export function createApiApp(dependencies?: ApiDependencies) {
  let defaultDependencies: ResolvedApiDependencies | null = null
  const getDependencies = () => {
    if (dependencies) return withDefaultWebhookVerifier(dependencies)
    defaultDependencies ??= createDefaultDependencies()
    return defaultDependencies
  }
  const authHandler = (request: Request) => {
    const handler = getDependencies().auth.handler
    return handler
      ? handler(request)
      : json({ error: "Auth handler is not configured" }, 503)
  }

  return new Elysia({ prefix: "/api" })
    .use(createHealthApi())
    .use(createRequestsApi(getDependencies))
    .use(createUploadsApi(getDependencies))
    .use(createLinearWebhooksApi(getDependencies))
    .use(createCronApi(getDependencies))
    .use(createSlackApi(getDependencies))
    .mount(authHandler)
}
