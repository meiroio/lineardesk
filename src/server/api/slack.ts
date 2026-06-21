import { Elysia } from "elysia"

import { buildTranscript } from "../ai/gemini"
import {
  mergeBugReportSections,
  parseCreateRequestInput,
  RequestValidationError,
} from "../request-validation"
import { extractMention, isUrlVerification } from "../slack/events"
import {
  buildLoadingModal,
  buildTicketModal,
  parseTicketSubmission,
} from "../slack/modal"
import { verifySlackSignature } from "../slack/signature"
import {
  createSlackTicket,
  SlackEmailDomainNotAllowedError,
  SlackEmailMissingError,
} from "../slack/ticket"
import type { ApiDependencyResolver } from "./dependencies"
import { json } from "./http"

type WaitUntil = (promise: Promise<unknown>) => void

type VercelRequestContext = {
  get?: () => { waitUntil?: WaitUntil } | undefined
}

// Resolve the runtime's waitUntil so post-ack background work keeps the
// serverless function alive. Vercel's Node runtime does NOT expose it on the
// Request; Workers-style runtimes attach it to the request/context object.
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
    waitUntil(safe)
    return
  }

  await safe
}

function getSlackTicketFailureMessage(
  error: unknown,
  context: "modal" | "mention"
) {
  const reason =
    error instanceof SlackEmailMissingError
      ? "your Slack account has no email"
      : error instanceof SlackEmailDomainNotAllowedError
        ? "your email domain is not approved for LinearDesk"
        : error instanceof Error
          ? error.message
          : "unknown error"

  if (error instanceof SlackEmailMissingError) {
    return ":warning: Your Slack account has no email, so I couldn't create a ticket."
  }

  return context === "modal"
    ? `:x: Sorry — creating the ticket failed: ${reason}`
    : `:x: Sorry — couldn't create a ticket from this thread: ${reason}`
}

export function createSlackApi(getDependencies: ApiDependencyResolver) {
  return new Elysia({ name: "api.slack" })
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
                orgAccess: deps.orgAccess,
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
            await slack
              .postMessage({
                channel: parsed.meta.channel,
                threadTs: parsed.meta.threadTs || undefined,
                text: getSlackTicketFailureMessage(error, "modal"),
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
              orgAccess: deps.orgAccess,
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
          await slack
            .postMessage({
              channel: mention.channel,
              threadTs: mention.threadTs,
              text: getSlackTicketFailureMessage(error, "mention"),
            })
            .catch((e) =>
              console.error("slack mention fallback postMessage failed", e)
            )
        }
      })()
      await scheduleBackground(request, work)
      return new Response("", { status: 200 })
    })
}
