import { Elysia } from "elysia"

import { buildTranscript } from "../ai/gemini"
import { scheduleBackground } from "../background"
import {
  mergeBugReportSections,
  parseCreateRequestInput,
  RequestValidationError,
  severityPriorityOf,
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
  resolveSlackRequester,
  SlackEmailDomainNotAllowedError,
  SlackEmailMissingError,
  SlackTicketCreationUncertainError,
} from "../slack/ticket"
import {
  EmptyResponseModel,
  ErrorResponseModel,
  SlackEventsResponseModel,
  SlackInteractivityResponseModel,
} from "./contracts"
import type { ApiDependenciesPlugin } from "./dependencies"

const THREAD_TRUNCATED_NOTICE =
  "Only part of this thread was included because it exceeded the drafting limit. Review the remaining messages and attachments."

function getSlackTicketFailureMessage(
  error: unknown,
  context: "modal" | "mention"
) {
  if (error instanceof SlackTicketCreationUncertainError) {
    return ":warning: I couldn't confirm ticket creation. Check Linear before retrying to avoid a duplicate ticket."
  }
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

export function createSlackApi(apiDependencies: ApiDependenciesPlugin) {
  return new Elysia({ name: "api.slack" })
    .use(apiDependencies)
    .post(
      "/slack/commands",
      async ({ request, resolveApiDependencies, status }) => {
        const deps = resolveApiDependencies()
        if (!deps.slack || !deps.config.slack)
          return status(404, { error: "not_found" })
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
          return status(401, { error: "bad_signature" })

        const form = new URLSearchParams(raw)
        const triggerId = form.get("trigger_id")
        const channel = form.get("channel_id") ?? ""
        if (!triggerId) return status(400, { error: "no_trigger" })

        await deps.slack.openView(
          triggerId,
          buildTicketModal({
            privateMetadata: {
              channel,
              messageTs: "",
              threadTs: "",
              files: [],
            },
          })
        )
        return ""
      },
      {
        response: {
          200: EmptyResponseModel,
          400: ErrorResponseModel,
          401: ErrorResponseModel,
          404: ErrorResponseModel,
        },
      }
    )
    .post(
      "/slack/interactivity",
      async ({ request, resolveApiDependencies, status }) => {
        const deps = resolveApiDependencies()
        if (!deps.slack || !deps.config.slack)
          return status(404, { error: "not_found" })
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
          return status(401, { error: "bad_signature" })

        const payload = JSON.parse(
          new URLSearchParams(raw).get("payload") ?? "{}"
        )

        if (payload.type === "message_action") {
          if (!payload.channel?.id || !payload.message?.ts) {
            return ""
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
            threadTs: (payload.message.thread_ts ??
              payload.message.ts) as string,
            files,
          }
          const messageText = (payload.message.text as string | undefined) ?? ""

          const slack = deps.slack
          const gemini = deps.gemini
          const viewId = await slack.openView(
            payload.trigger_id,
            buildLoadingModal()
          )
          const work = (async () => {
            let authorized = false
            try {
              await resolveSlackRequester(
                { slack, orgAccess: deps.orgAccess },
                payload.user.id
              )
              authorized = true
              let draft = { currentBehaviour: messageText }
              if (gemini) {
                const { messages, truncated } = await slack.getThreadReplies({
                  channel: meta.channel,
                  threadTs: meta.threadTs,
                })
                draft = await gemini.extractTicketDraft(
                  buildTranscript(messages)
                )
                if (truncated)
                  draft.currentBehaviour += `\n\n${THREAD_TRUNCATED_NOTICE}`
              }
              await slack.updateView(
                viewId,
                buildTicketModal({ prefill: draft, privateMetadata: meta })
              )
            } catch (error) {
              console.error("slack ai prefill failed", error)
              await slack
                .updateView(
                  viewId,
                  authorized
                    ? buildTicketModal({
                        prefill: { currentBehaviour: messageText },
                        privateMetadata: meta,
                      })
                    : {
                        type: "modal",
                        title: {
                          type: "plain_text",
                          text: "Ticket unavailable",
                        },
                        close: { type: "plain_text", text: "Close" },
                        blocks: [
                          {
                            type: "section",
                            text: {
                              type: "plain_text",
                              text: getSlackTicketFailureMessage(
                                error,
                                "modal"
                              ),
                            },
                          },
                        ],
                      }
                )
                .catch((updateError) => {
                  console.error("slack loading view update failed", updateError)
                })
            }
          })()
          await scheduleBackground(
            request,
            work,
            "slack background work failed"
          )
          return ""
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
              return { response_action: "errors", errors: error.fields }
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
              await slack
                .postMessage({
                  channel: parsed.meta.channel,
                  threadTs: parsed.meta.threadTs || undefined,
                  text: `:white_check_mark: Created *${result.issue.identifier}* — ${result.issue.url}${note}`,
                })
                .catch((error) =>
                  console.error(
                    "slack ticket created but confirmation failed",
                    error
                  )
                )
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

          await scheduleBackground(
            request,
            work,
            "slack background work failed"
          )
          return ""
        }

        return ""
      },
      {
        response: {
          200: SlackInteractivityResponseModel,
          401: ErrorResponseModel,
          404: ErrorResponseModel,
        },
      }
    )
    .post(
      "/slack/events",
      async ({ request, resolveApiDependencies, status }) => {
        const deps = resolveApiDependencies()
        if (!deps.slack || !deps.config.slack)
          return status(404, { error: "not_found" })
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
          return status(401, { error: "bad_signature" })

        const payload = JSON.parse(raw)
        if (isUrlVerification(payload)) return { challenge: payload.challenge }

        const mention = extractMention(payload)
        if (!mention) return ""
        if (!(await deps.repo.claimSlackEvent(mention.eventId))) return ""

        const slack = deps.slack
        const gemini = deps.gemini
        const baseUrl = deps.config.betterAuthUrl.replace(/\/+$/, "")
        const work = (async () => {
          try {
            const resolvedRequester = await resolveSlackRequester(
              { slack, orgAccess: deps.orgAccess },
              mention.user
            )
            if (!gemini) {
              await slack.postMessage({
                channel: mention.channel,
                threadTs: mention.threadTs,
                text: ':information_source: AI drafting isn’t enabled — use `/ticket` or the ⋯ "Create LinearDesk ticket" shortcut.',
              })
              return
            }
            const { messages, truncated } = await slack.getThreadReplies({
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
                resolvedRequester,
                title,
                description,
                severity: severityPriorityOf(draft.severity) ?? 3,
                channel: mention.channel,
                threadTs: mention.threadTs,
                files: images,
              }
            )
            const note =
              result.droppedImages > 0
                ? ` (couldn't attach ${result.droppedImages} image(s))`
                : ""
            await slack
              .postMessage({
                channel: mention.channel,
                threadTs: mention.threadTs,
                text: [
                  `:white_check_mark: Created *${result.issue.identifier}* from this thread${note} — here's the draft, give it a quick look:`,
                  "",
                  `*${title}*`,
                  `*Severity:* ${draft.severity[0].toUpperCase()}${draft.severity.slice(1)}`,
                  description,
                  ...(truncated
                    ? [`:warning: ${THREAD_TRUNCATED_NOTICE}`]
                    : []),
                  "",
                  `Not quite right? Edit it here: ${baseUrl}/requests/${result.record.id}`,
                ].join("\n"),
              })
              .catch((error) =>
                console.error(
                  "slack ticket created but confirmation failed",
                  error
                )
              )
          } catch (error) {
            console.error("slack mention auto-create failed", error)
            if (!(error instanceof SlackTicketCreationUncertainError)) {
              await deps.repo.releaseSlackEvent(mention.eventId)
            }
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
        await scheduleBackground(request, work, "slack background work failed")
        return ""
      },
      {
        response: {
          200: SlackEventsResponseModel,
          401: ErrorResponseModel,
          404: ErrorResponseModel,
        },
      }
    )
}
