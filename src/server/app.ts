import process from "node:process"

import { Elysia } from "elysia"

import { createAuthBridge } from "./auth"
import { isAllowedEmail, readAppConfig } from "./config"
import {
  buildRequesterReplyCommentBody,
  createLinearGateway,
  getDetailsCommentMarker,
} from "./linear"
import { reconcileOpenRequests } from "./reconcile"
import { createHelpdeskRepository } from "./repository"
import {
  mergeBugReportSections,
  parseCreateCommentInput,
  parseCreateRequestInput,
  parseUpdateRequestInput,
  RequestValidationError,
} from "./request-validation"
import { buildTranscript, createGeminiGateway } from "./ai/gemini"
import { extractMention, isUrlVerification } from "./slack/events"
import { createSlackGateway } from "./slack/gateway"
import {
  buildLoadingModal,
  buildTicketModal,
  parseTicketSubmission,
} from "./slack/modal"
import { verifySlackSignature } from "./slack/signature"
import { createSlackTicket, SlackEmailMissingError } from "./slack/ticket"
import type {
  AppConfig,
  AuthBridge,
  AuthSession,
  CloseIssueResolution,
  GeminiGateway,
  HelpdeskRepository,
  LinearGateway,
  LinearIssueCommentSnapshot,
  RequestRecord,
  SlackGateway,
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
  slack?: SlackGateway
  gemini?: GeminiGateway
  verifyWebhook?: VerifyWebhook
}

type WaitUntil = (promise: Promise<unknown>) => void

type VercelRequestContext = {
  get?: () => { waitUntil?: WaitUntil } | undefined
}

// Resolve the runtime's waitUntil so post-ack background work keeps the
// serverless function alive. Vercel's Node runtime does NOT expose it on the
// Request — it lives on a request-context global backed by AsyncLocalStorage
// (the same place @vercel/functions reads). Workers-style runtimes attach it
// to the request/context object, so check that first.
function getWaitUntil(request: Request): WaitUntil | undefined {
  const onRequest = (request as { waitUntil?: WaitUntil }).waitUntil
  if (typeof onRequest === "function") return onRequest.bind(request)

  const store = (
    globalThis as Record<symbol, VercelRequestContext | undefined>
  )[Symbol.for("@vercel/request-context")]
  const ctx = store?.get?.()
  if (ctx && typeof ctx.waitUntil === "function") return ctx.waitUntil.bind(ctx)

  return undefined
}

async function scheduleBackground(request: Request, work: Promise<unknown>) {
  const safe = work.catch((error) => {
    console.error("slack background work failed", error)
  })
  const waitUntil = getWaitUntil(request)
  if (waitUntil) {
    // Fast path: hand the promise to the runtime and return the ack now.
    waitUntil(safe)
    return
  }
  // No waitUntil available (local dev, or a runtime that doesn't surface it):
  // AWAIT the work so it actually runs before the function suspends. On Vercel
  // this may exceed Slack's 3s ack window, but the event_id dedup turns the
  // ensuing retry into a no-op, so the work still completes exactly once.
  await safe
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

function parseResolution(body: unknown): CloseIssueResolution | null {
  if (!body || typeof body !== "object" || !("resolution" in body)) return null
  const value = body.resolution
  return value === "resolved" || value === "canceled" ? value : null
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

      const requests = await getDependencies().repo.listRequestsForEmail(
        session.user.email
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
        organizationId: null,
        requesterEmail: session.user.email,
        ...issueInput,
        severity,
        linearIssue,
        linearTeamId: deps.config.linear.teamId,
        source: "web",
      })

      return json({ request: serializeRequest(record) }, 201)
    })
    .get("/requests/:id", async ({ params, request }) => {
      const session = await requireAuthorizedSession(
        getDependencies(),
        request.headers
      )
      if (session instanceof Response) return session

      const record = await getDependencies().repo.getRequestForEmail(
        params.id,
        session.user.email
      )
      if (!record) return json({ error: "not_found" }, 404)

      const allComments = await getDependencies().linear.listIssueComments(
        record.linearIssueId
      )
      const detailsMarker = getDetailsCommentMarker(record.linearIssueId)
      const comments = allComments.filter(
        (comment) =>
          comment.id !== record.linearDetailsCommentId &&
          !comment.body.includes(detailsMarker)
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

      const record = await deps.repo.getRequestForEmail(
        params.id,
        session.user.email
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
    .post("/requests/:id/close", async ({ params, body, request }) => {
      const deps = getDependencies()
      const session = await requireAuthorizedSession(deps, request.headers)
      if (session instanceof Response) return session

      const resolution = parseResolution(body)
      if (!resolution) {
        return json(
          {
            error: "validation_error",
            issues: ["resolution must be 'resolved' or 'canceled'"],
          },
          400
        )
      }

      const record = await deps.repo.getRequestForEmail(
        params.id,
        session.user.email
      )
      if (!record) return json({ error: "not_found" }, 404)

      const state = await deps.linear.closeIssue({
        issueId: record.linearIssueId,
        resolution,
      })
      await deps.repo.updateRequestFromLinear({
        linearIssueId: record.linearIssueId,
        linearIdentifier: record.linearIdentifier,
        linearUrl: record.linearUrl,
        linearStateId: state.id,
        linearStateName: state.name,
        linearStateType: state.type,
      })

      const updated = await deps.repo.getRequestForEmail(
        params.id,
        session.user.email
      )
      return { request: serializeRequest(updated ?? record) }
    })
    .post("/requests/:id/update", async ({ params, body, request }) => {
      const deps = getDependencies()
      const session = await requireAuthorizedSession(deps, request.headers)
      if (session instanceof Response) return session

      let input: ReturnType<typeof parseUpdateRequestInput>
      try {
        input = parseUpdateRequestInput(body)
      } catch (error) {
        if (error instanceof RequestValidationError) {
          return json(
            {
              error: "validation_error",
              issues: error.issues,
              fields: error.fields,
            },
            400
          )
        }
        throw error
      }

      const record = await deps.repo.getRequestForEmail(
        params.id,
        session.user.email
      )
      if (!record) return json({ error: "not_found" }, 404)
      if (
        ["completed", "canceled", "duplicate"].includes(record.linearStateType)
      ) {
        return json({ error: "ticket_closed" }, 409)
      }

      await deps.linear.updateIssueFields({
        issueId: record.linearIssueId,
        title: input.title,
        description: input.description,
        priority: input.severity,
      })
      const updated = await deps.repo.updateRequestFields({
        id: record.id,
        title: input.title,
        description: input.description,
        severity: input.severity,
      })
      return { request: serializeRequest(updated ?? record) }
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
    .get("/cron/reconcile", async ({ request }) => {
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
    })
    .post("/slack/commands", async ({ request }) => {
      const deps = getDependencies()
      if (!deps.slack || !deps.config.slack)
        return json({ error: "not_found" }, 404)
      const raw = await request.text()
      if (
        !verifySlackSignature({
          signingSecret: deps.config.slack.signingSecret,
          signature: request.headers.get("x-slack-signature"),
          timestamp: request.headers.get("x-slack-request-timestamp"),
          rawBody: raw,
          nowMs: Date.now(),
        })
      )
        return json({ error: "bad_signature" }, 401)

      const form = new URLSearchParams(raw)
      const triggerId = form.get("trigger_id")
      const channel = form.get("channel_id") ?? ""
      if (!triggerId) return json({ error: "no_trigger" }, 400)

      await deps.slack.openView(
        triggerId,
        buildTicketModal({
          privateMetadata: { channel, messageTs: "", threadTs: "", files: [] },
        })
      )
      return new Response("", { status: 200 })
    })
    .post("/slack/interactivity", async ({ request }) => {
      const deps = getDependencies()
      if (!deps.slack || !deps.config.slack)
        return json({ error: "not_found" }, 404)
      const raw = await request.text()
      if (
        !verifySlackSignature({
          signingSecret: deps.config.slack.signingSecret,
          signature: request.headers.get("x-slack-signature"),
          timestamp: request.headers.get("x-slack-request-timestamp"),
          rawBody: raw,
          nowMs: Date.now(),
        })
      )
        return json({ error: "bad_signature" }, 401)

      const payload = JSON.parse(
        new URLSearchParams(raw).get("payload") ?? "{}"
      )

      if (payload.type === "message_action") {
        if (!payload.channel?.id || !payload.message?.ts) {
          return new Response("", { status: 200 })
        }
        const files = Array.isArray(payload.message?.files)
          ? payload.message.files.map(
              (f: {
                id: string
                name: string
                mimetype: string
                url_private: string
              }) => ({
                id: f.id,
                name: f.name,
                mimetype: f.mimetype,
                urlPrivate: f.url_private,
              })
            )
          : []
        const meta = {
          channel: payload.channel.id as string,
          messageTs: payload.message.ts as string,
          threadTs: (payload.message.thread_ts ?? payload.message.ts) as string,
          files,
        }
        const messageText = (payload.message.text as string | undefined) ?? ""

        if (!deps.gemini) {
          await deps.slack.openView(
            payload.trigger_id,
            buildTicketModal({
              prefill: { currentBehaviour: messageText },
              privateMetadata: meta,
            })
          )
          return new Response("", { status: 200 })
        }

        const slack = deps.slack
        const gemini = deps.gemini
        const viewId = await slack.openView(
          payload.trigger_id,
          buildLoadingModal()
        )
        const work = (async () => {
          try {
            const { messages } = await slack.getThreadReplies({
              channel: meta.channel,
              threadTs: meta.threadTs,
            })
            const draft = await gemini.extractTicketDraft(
              buildTranscript(messages)
            )
            await slack.updateView(
              viewId,
              buildTicketModal({ prefill: draft, privateMetadata: meta })
            )
          } catch (error) {
            console.error("slack ai prefill failed", error)
            await slack
              .updateView(
                viewId,
                buildTicketModal({
                  prefill: { currentBehaviour: messageText },
                  privateMetadata: meta,
                })
              )
              .catch((updateError) => {
                console.error("slack loading view update failed", updateError)
              })
          }
        })()
        await scheduleBackground(request, work)
        return new Response("", { status: 200 })
      }

      if (
        payload.type === "view_submission" &&
        payload.view?.callback_id === "slack_ticket_submit"
      ) {
        const parsed = parseTicketSubmission(payload)
        let input: ReturnType<typeof parseCreateRequestInput>
        try {
          input = parseCreateRequestInput({
            title: parsed.title,
            expectedBehaviour: parsed.expectedBehaviour,
            currentBehaviour: parsed.currentBehaviour,
            stepsToReproduce: parsed.stepsToReproduce,
            severity: parsed.severityLabel,
          })
        } catch (error) {
          if (error instanceof RequestValidationError) {
            return json(
              { response_action: "errors", errors: error.fields },
              200
            )
          }
          throw error
        }

        const slack = deps.slack
        const work = (async () => {
          try {
            const result = await createSlackTicket(
              {
                config: deps.config,
                repo: deps.repo,
                linear: deps.linear,
                slack,
              },
              {
                slackUserId: parsed.slackUserId,
                title: input.title,
                description: input.description,
                severity: input.severity,
                channel: parsed.meta.channel,
                threadTs: parsed.meta.threadTs,
                files: parsed.meta.files,
              }
            )
            const note =
              result.droppedImages > 0
                ? ` (couldn't attach ${result.droppedImages} image(s))`
                : ""
            await slack.postMessage({
              channel: parsed.meta.channel,
              threadTs: parsed.meta.threadTs || undefined,
              text: `:white_check_mark: Created *${result.issue.identifier}* — ${result.issue.url}${note}`,
            })
          } catch (error) {
            console.error("slack ticket creation failed", error)
            const reason =
              error instanceof Error ? error.message : "unknown error"
            const text =
              error instanceof SlackEmailMissingError
                ? ":warning: Your Slack account has no email, so I couldn't create a ticket."
                : `:x: Sorry — creating the ticket failed: ${reason}`
            await slack
              .postMessage({
                channel: parsed.meta.channel,
                threadTs: parsed.meta.threadTs || undefined,
                text,
              })
              .catch((postError) => {
                console.error("slack fallback postMessage failed", postError)
              })
          }
        })()

        await scheduleBackground(request, work)
        return new Response("", { status: 200 })
      }

      return new Response("", { status: 200 })
    })
    .post("/slack/events", async ({ request }) => {
      const deps = getDependencies()
      if (!deps.slack || !deps.config.slack)
        return json({ error: "not_found" }, 404)
      const raw = await request.text()
      if (
        !verifySlackSignature({
          signingSecret: deps.config.slack.signingSecret,
          signature: request.headers.get("x-slack-signature"),
          timestamp: request.headers.get("x-slack-request-timestamp"),
          rawBody: raw,
          nowMs: Date.now(),
        })
      )
        return json({ error: "bad_signature" }, 401)

      const payload = JSON.parse(raw)
      if (isUrlVerification(payload))
        return json({ challenge: payload.challenge })

      const mention = extractMention(payload)
      if (!mention) return new Response("", { status: 200 })
      if (await deps.repo.hasProcessedSlackEvent(mention.eventId))
        return new Response("", { status: 200 })
      await deps.repo.recordSlackEvent(mention.eventId)

      const slack = deps.slack
      const gemini = deps.gemini
      // Trim any trailing slash so the portal link doesn't end up with a
      // double slash (BETTER_AUTH_URL is often configured as "https://host/").
      const baseUrl = deps.config.betterAuthUrl.replace(/\/+$/, "")
      const work = (async () => {
        try {
          if (!gemini) {
            await slack.postMessage({
              channel: mention.channel,
              threadTs: mention.threadTs,
              text: ':information_source: AI drafting isn’t enabled — use `/ticket` or the ⋯ "Create LinearDesk ticket" shortcut.',
            })
            return
          }
          const { messages } = await slack.getThreadReplies({
            channel: mention.channel,
            threadTs: mention.threadTs,
          })
          const draft = await gemini.extractTicketDraft(
            buildTranscript(messages)
          )
          const description = mergeBugReportSections({
            expectedBehaviour: draft.expectedBehaviour,
            currentBehaviour: draft.currentBehaviour,
            stepsToReproduce: draft.stepsToReproduce,
          })
          const title = draft.title.trim() || "Bug reported via Slack"
          const images = messages
            .flatMap((m) => m.files)
            .filter((f) => f.mimetype.startsWith("image/"))
          const result = await createSlackTicket(
            {
              config: deps.config,
              repo: deps.repo,
              linear: deps.linear,
              slack,
            },
            {
              slackUserId: mention.user,
              title,
              description,
              severity: 3,
              channel: mention.channel,
              threadTs: mention.threadTs,
              files: images,
            }
          )
          const note =
            result.droppedImages > 0
              ? ` (couldn't attach ${result.droppedImages} image(s))`
              : ""
          // Echo the AI draft back into the thread so the requester can
          // validate what was created at a glance, without opening the portal.
          await slack.postMessage({
            channel: mention.channel,
            threadTs: mention.threadTs,
            text: [
              `:white_check_mark: Created *${result.issue.identifier}* from this thread${note} — here's the draft, give it a quick look:`,
              "",
              `*${title}*`,
              description,
              "",
              `Not quite right? Edit it here: ${baseUrl}/requests/${result.record.id}`,
            ].join("\n"),
          })
        } catch (error) {
          console.error("slack mention auto-create failed", error)
          const text =
            error instanceof SlackEmailMissingError
              ? ":warning: Your Slack account has no email, so I couldn't create a ticket."
              : `:x: Sorry — couldn't create a ticket from this thread: ${error instanceof Error ? error.message : "unknown error"}`
          await slack
            .postMessage({
              channel: mention.channel,
              threadTs: mention.threadTs,
              text,
            })
            .catch((e) =>
              console.error("slack mention fallback postMessage failed", e)
            )
        }
      })()
      await scheduleBackground(request, work)
      return new Response("", { status: 200 })
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
    slack: config.slack ? createSlackGateway(config.slack.botToken) : undefined,
    gemini: config.gemini ? createGeminiGateway(config.gemini) : undefined,
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
