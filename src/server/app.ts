import { Elysia } from "elysia"

import { createAuthBridge } from "./auth"
import { isAllowedEmail, readAppConfig } from "./config"
import { buildRequesterReplyCommentBody, createLinearGateway } from "./linear"
import { createHelpdeskRepository } from "./repository"
import {
  parseCreateCommentInput,
  parseCreateRequestInput,
  RequestValidationError,
} from "./request-validation"
import type {
  AppConfig,
  AuthBridge,
  AuthSession,
  HelpdeskRepository,
  LinearGateway,
  LinearIssueCommentSnapshot,
  RequestRecord,
  VerifyWebhook,
} from "./types"
import {
  extractIssueSnapshotFromWebhook,
  getLinearWebhookEventKey,
  hashRawBody,
  LINEAR_WEBHOOK_SIGNATURE_HEADER,
  LINEAR_WEBHOOK_TS_HEADER,
  verifyLinearWebhookPayload,
} from "./webhooks"

export type ApiDependencies = {
  config: AppConfig
  repo: HelpdeskRepository
  linear: LinearGateway
  auth: AuthBridge
  verifyWebhook?: VerifyWebhook
}

type ResolvedApiDependencies = ApiDependencies & {
  verifyWebhook: VerifyWebhook
}

const ALLOWED_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024

function sanitizeFilename(value: string | null): string {
  if (!value) return "image"
  let decoded = value
  try {
    decoded = decodeURIComponent(value)
  } catch {
    decoded = value
  }
  const base = decoded.split(/[\\/]/).pop() ?? "image"
  const cleaned = base.replace(/[^\w.-]+/g, "_").slice(0, 100)
  return cleaned || "image"
}

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
    .get("/health", () => ({ ok: true }))
    .get("/requests", async ({ request }) => {
      const session = await requireAuthorizedSession(
        getDependencies(),
        request.headers
      )
      if (session instanceof Response) return session

      const requests = await getDependencies().repo.listRequestsForUser(
        session.user.id
      )
      return { requests: requests.map((record) => serializeRequest(record)) }
    })
    .post("/requests", async ({ body, request }) => {
      const deps = getDependencies()
      const session = await requireAuthorizedSession(deps, request.headers)
      if (session instanceof Response) return session

      let input: ReturnType<typeof parseCreateRequestInput>
      try {
        input = parseCreateRequestInput(body)
      } catch (error) {
        if (error instanceof RequestValidationError) {
          return json({ error: "validation_error", issues: error.issues }, 400)
        }

        throw error
      }

      const { severity, ...issueInput } = input
      const linearIssue = await deps.linear.createHelpdeskIssue({
        ...issueInput,
        requesterEmail: session.user.email,
        priority: severity,
      })
      const record = await deps.repo.createRequest({
        requesterUserId: session.user.id,
        requesterEmail: session.user.email,
        ...issueInput,
        severity,
        linearIssue,
        linearTeamId: deps.config.linear.teamId,
      })

      return json({ request: serializeRequest(record) }, 201)
    })
    .get("/requests/:id", async ({ params, request }) => {
      const session = await requireAuthorizedSession(
        getDependencies(),
        request.headers
      )
      if (session instanceof Response) return session

      const record = await getDependencies().repo.getRequestForUser(
        params.id,
        session.user.id
      )
      if (!record) return json({ error: "not_found" }, 404)

      const comments = await getDependencies().linear.listIssueComments(
        record.linearIssueId
      )

      return { request: serializeRequest(record, comments) }
    })
    .post("/requests/:id/comments", async ({ params, body, request }) => {
      const deps = getDependencies()
      const session = await requireAuthorizedSession(deps, request.headers)
      if (session instanceof Response) return session

      let input: ReturnType<typeof parseCreateCommentInput>
      try {
        input = parseCreateCommentInput(body)
      } catch (error) {
        if (error instanceof RequestValidationError) {
          return json({ error: "validation_error", issues: error.issues }, 400)
        }

        throw error
      }

      const record = await deps.repo.getRequestForUser(
        params.id,
        session.user.id
      )
      if (!record) return json({ error: "not_found" }, 404)

      const comment = await deps.linear.createIssueComment({
        issueId: record.linearIssueId,
        body: buildRequesterReplyCommentBody({
          requesterEmail: session.user.email,
          body: input.body,
        }),
      })

      return json({ comment: serializeLinearComment(comment) }, 201)
    })
    .post("/uploads", async ({ request }) => {
      const deps = getDependencies()
      const session = await requireAuthorizedSession(deps, request.headers)
      if (session instanceof Response) return session

      const contentType = (request.headers.get("content-type") ?? "")
        .split(";")[0]
        .trim()
        .toLowerCase()
      if (!ALLOWED_IMAGE_TYPES.includes(contentType)) {
        return json(
          { error: "validation_error", issues: ["Unsupported image type"] },
          400
        )
      }

      const bytes = new Uint8Array(await request.arrayBuffer())
      if (bytes.byteLength === 0) {
        return json({ error: "validation_error", issues: ["Empty file"] }, 400)
      }
      if (bytes.byteLength > MAX_UPLOAD_BYTES) {
        return json({ error: "file_too_large" }, 413)
      }

      const filename = sanitizeFilename(request.headers.get("x-filename"))
      const asset = await deps.linear.uploadAsset({
        contentType,
        filename,
        bytes,
      })

      return json({ assetUrl: asset.assetUrl, filename }, 201)
    })
    .post("/linear/webhook", async ({ request }) => {
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
    })
    .mount(authHandler)
}

function createDefaultDependencies(): ResolvedApiDependencies {
  const config = readAppConfig()

  return {
    config,
    repo: createHelpdeskRepository(),
    linear: createLinearGateway(config.linear),
    auth: createAuthBridge(config),
    verifyWebhook: ({ rawBody, signature, timestamp }) => {
      if (!signature) throw new Error("Missing Linear webhook signature")

      return verifyLinearWebhookPayload({
        rawBody,
        signature,
        timestamp,
        secret: config.linear.webhookSecret,
      })
    },
  }
}

function withDefaultWebhookVerifier(
  deps: ApiDependencies
): ResolvedApiDependencies {
  return {
    ...deps,
    verifyWebhook:
      deps.verifyWebhook ??
      (({ rawBody, signature, timestamp }) => {
        if (!signature) throw new Error("Missing Linear webhook signature")

        return verifyLinearWebhookPayload({
          rawBody,
          signature,
          timestamp,
          secret: deps.config.linear.webhookSecret,
        })
      }),
  }
}

async function requireAuthorizedSession(
  deps: ResolvedApiDependencies,
  headers: Headers
): Promise<AuthSession | Response> {
  const session = await deps.auth.getSession(headers)
  if (!session) return json({ error: "unauthorized" }, 401)

  if (!isAllowedEmail(session.user.email, deps.config.allowedEmailDomains)) {
    return json({ error: "forbidden_domain" }, 403)
  }

  return session
}

function serializeRequest(
  record: RequestRecord,
  comments?: LinearIssueCommentSnapshot[]
) {
  return {
    ...record,
    linearDetailsCommentedAt:
      record.linearDetailsCommentedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    lastLinearSyncedAt: record.lastLinearSyncedAt.toISOString(),
    comments: comments?.map(serializeLinearComment),
  }
}

function serializeLinearComment(comment: LinearIssueCommentSnapshot) {
  return {
    ...comment,
    createdAt: comment.createdAt.toISOString(),
  }
}

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json",
    },
  })
}
