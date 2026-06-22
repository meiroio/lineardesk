import process from "node:process"

import { Elysia } from "elysia"

import { reconcileOpenRequests } from "../reconcile"
import { CronReconcileResponseModel, ErrorResponseModel } from "./contracts"
import type { ApiDependenciesPlugin } from "./dependencies"

export function createCronApi(apiDependencies: ApiDependenciesPlugin) {
  return new Elysia({ name: "api.cron" }).use(apiDependencies).get(
    "/cron/reconcile",
    async ({ request, resolveApiDependencies, status }) => {
      const secret = process.env.CRON_SECRET
      if (
        !secret ||
        request.headers.get("authorization") !== `Bearer ${secret}`
      ) {
        return status(401, { error: "unauthorized" })
      }

      const deps = resolveApiDependencies()
      const result = await reconcileOpenRequests({
        repo: deps.repo,
        linear: deps.linear,
        limit: 200,
      })

      return { ok: true, ...result }
    },
    {
      response: {
        200: CronReconcileResponseModel,
        401: ErrorResponseModel,
      },
    }
  )
}
