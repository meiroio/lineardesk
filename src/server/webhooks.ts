import { Buffer } from "node:buffer"
import { createHash } from "node:crypto"

import {
  LINEAR_WEBHOOK_SIGNATURE_HEADER,
  LINEAR_WEBHOOK_TS_HEADER,
  LinearWebhookClient,
} from "@linear/sdk/webhooks"

import type { LinearIssueWebhookSnapshot } from "./types"

type UnknownRecord = Record<string, unknown>

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" ? (value as UnknownRecord) : null
}

function asString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null
}

export function verifyLinearWebhookPayload(input: {
  rawBody: string
  signature: string
  timestamp?: string | null
  secret: string
}) {
  const client = new LinearWebhookClient(input.secret)
  return client.parseData(
    Buffer.from(input.rawBody),
    input.signature,
    input.timestamp ?? undefined
  )
}

export function getLinearWebhookEventKey(payload: unknown) {
  const record = asRecord(payload)
  const data = asRecord(record?.data)
  const type = asString(record?.type) ?? "unknown"
  const action = asString(record?.action) ?? "unknown"
  const webhookId = asString(record?.webhookId) ?? "unknown"
  const issueId = asString(data?.id) ?? "unknown"
  const timestamp = record?.webhookTimestamp?.toString() ?? "unknown"

  return [type, action, webhookId, issueId, timestamp].join(":")
}

export function hashRawBody(rawBody: string) {
  return createHash("sha256").update(rawBody).digest("hex")
}

export function extractIssueSnapshotFromWebhook(
  payload: unknown
): LinearIssueWebhookSnapshot | null {
  const record = asRecord(payload)
  if (record?.type !== "Issue") return null

  const data = asRecord(record.data)
  const state = asRecord(data?.state)
  const linearIssueId = asString(data?.id)
  const linearIdentifier = asString(data?.identifier)
  const linearUrl = asString(data?.url)
  const linearStateId = asString(state?.id)
  const linearStateName = asString(state?.name)
  const linearStateType = asString(state?.type)

  if (
    !linearIssueId ||
    !linearIdentifier ||
    !linearUrl ||
    !linearStateId ||
    !linearStateName ||
    !linearStateType
  ) {
    return null
  }

  return {
    linearIssueId,
    linearIdentifier,
    linearUrl,
    linearStateId,
    linearStateName,
    linearStateType,
  }
}

export { LINEAR_WEBHOOK_SIGNATURE_HEADER, LINEAR_WEBHOOK_TS_HEADER }
