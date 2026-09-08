import { Elysia } from "elysia"

import { scheduleBackground } from "../background"
import {
  extractIssueSnapshotFromWebhook,
  extractLinearChangeFromWebhook,
  getLinearWebhookEventKey,
  hashRawBody,
  LINEAR_WEBHOOK_SIGNATURE_HEADER,
  LINEAR_WEBHOOK_TS_HEADER,
} from "../webhooks"
import { notifyRequestCreator } from "../slack/notifications"
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
      const snapshot = extractIssueSnapshotFromWebhook(payload)
      const change = extractLinearChangeFromWebhook(payload)
      const linearIssueId =
        snapshot?.linearIssueId ?? change?.linearIssueId ?? null
      const claimed = await deps.repo.applyWebhookEvent({
        eventKey,
        linearIssueId,
        rawBodyHash: hashRawBody(rawBody),
        snapshot,
      })
      if (!claimed) return { ok: true, duplicate: true }
      const record =
        deps.slack && change && linearIssueId
          ? await deps.repo.getRequestByLinearIssueId(linearIssueId)
          : null

      if (
        deps.slack &&
        record &&
        change &&
        !(
          change.kind === "comment" &&
          change.commentId === record.linearDetailsCommentId
        )
      ) {
        await scheduleBackground(
          request,
          notifyRequestCreator({
            slack: deps.slack,
            request: record,
            change,
            baseUrl: deps.config.betterAuthUrl,
          }),
          "slack requester notification failed"
        )
      }

      return { ok: true, ignored: !snapshot && !change }
    },
    {
      response: {
        200: LinearWebhookResponseModel,
        400: ErrorResponseModel,
      },
    }
  )
}
