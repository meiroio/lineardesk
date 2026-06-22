import { Elysia } from "elysia"

import {
  extractIssueSnapshotFromWebhook,
  getLinearWebhookEventKey,
  hashRawBody,
  LINEAR_WEBHOOK_SIGNATURE_HEADER,
  LINEAR_WEBHOOK_TS_HEADER,
} from "../webhooks"
import { ErrorResponseModel, LinearWebhookResponseModel } from "./contracts"
import type { ApiDependenciesPlugin } from "./dependencies"

export function createLinearWebhooksApi(
  apiDependencies: ApiDependenciesPlugin
) {
  return new Elysia({ name: "api.linear-webhooks" }).use(apiDependencies).post(
    "/linear/webhook",
    async ({ request, resolveApiDependencies, status }) => {
      const deps = resolveApiDependencies()
      const rawBody = await request.text()
      let payload: unknown

      try {
        payload = await deps.verifyWebhook({
          rawBody,
          signature: request.headers.get(LINEAR_WEBHOOK_SIGNATURE_HEADER),
          timestamp: request.headers.get(LINEAR_WEBHOOK_TS_HEADER),
        })
      } catch {
        return status(400, { error: "invalid_webhook" })
      }

      const eventKey = getLinearWebhookEventKey(payload)
      if (await deps.repo.hasProcessedWebhookEvent(eventKey)) {
        return { ok: true, duplicate: true }
      }

      const snapshot = extractIssueSnapshotFromWebhook(payload)
      if (snapshot) await deps.repo.updateRequestFromLinear(snapshot)

      await deps.repo.recordWebhookEvent(
        eventKey,
        snapshot?.linearIssueId ?? null,
        hashRawBody(rawBody)
      )

      return { ok: true, ignored: !snapshot }
    },
    {
      response: {
        200: LinearWebhookResponseModel,
        400: ErrorResponseModel,
      },
    }
  )
}
