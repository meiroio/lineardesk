import { getSharedLinearCommentBody } from "../linear"
import type { LinearWebhookChange } from "../webhooks"
import type { RequestRecord, SlackGateway } from "../types"

export async function notifyRequestCreator(input: {
  slack: Pick<SlackGateway, "findUserIdByEmail" | "postMessage">
  request: RequestRecord
  change: LinearWebhookChange
  baseUrl: string
}): Promise<boolean> {
  const { request, slack, baseUrl } = input
  let { change } = input
  if (change.kind === "comment") {
    if (change.action === "remove") return false
    const body = getSharedLinearCommentBody(request, {
      id: change.commentId,
      body: change.body,
    })
    if (!body) return false
    change = { ...change, body }
  }

  const userId = await slack.findUserIdByEmail(request.requesterEmail)
  if (!userId) return false

  const message = {
    text: formatNotification(request, change, baseUrl, userId),
    channel: request.slackChannelId ?? userId,
    threadTs: request.slackMessageTs || undefined,
  }

  try {
    await slack.postMessage(message)
  } catch (error) {
    if (message.channel === userId) throw error
    await slack.postMessage({ channel: userId, text: message.text })
  }

  return true
}

function formatNotification(
  request: RequestRecord,
  change: LinearWebhookChange,
  baseUrl: string,
  userId: string
) {
  const issue = `*${escapeSlackText(request.linearIdentifier)}*`
  const link = `<${baseUrl.replace(/\/+$/, "")}/requests/${request.id}|Open request>`
  const actor = change.actorName
    ? `*${escapeSlackText(change.actorName)}*`
    : "Someone in Linear"

  if (change.kind === "comment") {
    const verb = change.action === "update" ? "updated a comment" : "commented"
    const excerpt = change.body
      ? `\n>${escapeSlackText(change.body.slice(0, 800)).replaceAll("\n", "\n>")}`
      : ""
    return `<@${userId}> ${actor} ${verb} on ${issue}:${excerpt}\n${link}`
  }

  if (
    change.stateId &&
    change.stateName &&
    change.stateId !== request.linearStateId
  ) {
    return `<@${userId}> ${actor} moved ${issue} to *${escapeSlackText(change.stateName)}*. ${link}`
  }

  const verb = change.action === "remove" ? "removed" : "updated"
  return `<@${userId}> ${actor} ${verb} ${issue} in Linear. ${link}`
}

function escapeSlackText(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
}
