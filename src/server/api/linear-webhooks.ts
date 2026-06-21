import { Elysia } from "elysia"

import {
  extractIssueSnapshotFromWebhook,
  getLinearWebhookEventKey,
  hashRawBody,
  LINEAR_WEBHOOK_SIGNATURE_HEADER,
  LINEAR_WEBHOOK_TS_HEADER,
} from "../webhooks"
import { LinearWebhookResponseModel } from "./contracts"
import type { ApiDependencyResolver } from "./dependencies"
import { json } from "./http"

export function createLinearWebhooksApi(
  getDependencies: ApiDependencyResolver
) {
  return new Elysia({ name: "api.linear-webhooks" }).post(
    "/linear/webhook",
    async ({ request }) => {
      const deps = getDependencies()
      const rawBody = await request.text()
      let payload: unknown

      try {
        payload = await deps.verifyWebhook({
          rawBody,
          signature: request.headers.get(LINEAR_WEBHOOK_SIGNATURE_HEADER),
          timestamp: request.headers.get(LINEAR_WEBHOOK_TS_HEADER),
        })
      } catch {
        return json({ error: "invalid_webhook" }, 400)
      }

      const eventKey = getLinearWebhookEventKey(payload)
      if (await deps.repo.hasProcessedWebhookEvent(eventKey)) {
        return json({ ok: true, duplicate: true })
      }

      const snapshot = extractIssueSnapshotFromWebhook(payload)
      if (snapshot) await deps.repo.updateRequestFromLinear(snapshot)

      await deps.repo.recordWebhookEvent(
        eventKey,
        snapshot?.linearIssueId ?? null,
        hashRawBody(rawBody)
      )

      return json({ ok: true, ignored: !snapshot })
    },
    {
      response: LinearWebhookResponseModel,
    }
  )
}
