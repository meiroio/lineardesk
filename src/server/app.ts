import { Elysia } from "elysia"

import { createCronApi } from "./api/cron"
import {
  createApiDependenciesPlugin,
  createDefaultDependencies,
  withDefaultWebhookVerifier,
} from "./api/dependencies"
import type {
  ApiDependencies,
  ResolvedApiDependencies,
} from "./api/dependencies"
import { createHealthApi } from "./api/health"
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
      : Response.json(
          { error: "Auth handler is not configured" },
          { status: 503 }
        )
  }
  const apiDependencies = createApiDependenciesPlugin(getDependencies)

  return new Elysia({ prefix: "/api" })
    .use(apiDependencies)
    .use(createHealthApi())
    .use(createRequestsApi(apiDependencies))
    .use(createUploadsApi(apiDependencies))
    .use(createLinearWebhooksApi(apiDependencies))
    .use(createCronApi(apiDependencies))
    .use(createSlackApi(apiDependencies))
    .mount(authHandler)
}
