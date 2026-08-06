import type { LinearWebhookChange } from "../webhooks"
import type { RequestRecord, SlackGateway } from "../types"

export async function notifyRequestCreator(input: {
  slack: Pick<SlackGateway, "findUserIdByEmail" | "postMessage">
  request: RequestRecord
  change: LinearWebhookChange
  baseUrl: string
}): Promise<boolean> {
  const userId = await input.slack.findUserIdByEmail(
    input.request.requesterEmail
  )
  if (!userId) return false

  const message = {
    text: formatNotification(
      input.request,
      input.change,
      input.baseUrl,
      userId
    ),
    channel: input.request.slackChannelId ?? userId,
    threadTs: input.request.slackMessageTs || undefined,
  }

  try {
    await input.slack.postMessage(message)
  } catch (error) {
    if (message.channel === userId) throw error
    await input.slack.postMessage({ channel: userId, text: message.text })
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
    if (change.action === "remove") {
      return `<@${userId}> ${actor} removed a comment from ${issue}. ${link}`
    }

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
