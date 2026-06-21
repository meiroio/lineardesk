import process from "node:process"

import { Elysia } from "elysia"

import { reconcileOpenRequests } from "../reconcile"
import { CronReconcileResponseModel } from "./contracts"
import type { ApiDependencyResolver } from "./dependencies"
import { json } from "./http"

export function createCronApi(getDependencies: ApiDependencyResolver) {
  return new Elysia({ name: "api.cron" }).get(
    "/cron/reconcile",
    async ({ request }) => {
      const secret = process.env.CRON_SECRET
      if (
        !secret ||
        request.headers.get("authorization") !== `Bearer ${secret}`
      ) {
        return json({ error: "unauthorized" }, 401)
      }

      const deps = getDependencies()
      const result = await reconcileOpenRequests({
        repo: deps.repo,
        linear: deps.linear,
        limit: 200,
      })

      return json({ ok: true, ...result })
    },
    {
      response: CronReconcileResponseModel,
    }
  )
}
