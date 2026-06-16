type SlackEventEnvelope = {
  type?: string
  challenge?: string
  event_id?: string
  event?: {
    type?: string
    user?: string
    channel?: string
    ts?: string
    thread_ts?: string
    bot_id?: string
  }
}

export function isUrlVerification(payload: SlackEventEnvelope): boolean {
  return payload.type === "url_verification"
}

export function extractMention(payload: SlackEventEnvelope): {
  eventId: string
  user: string
  channel: string
  threadTs: string
} | null {
  const e = payload.event
  if (!e || e.type !== "app_mention") return null
  if (e.bot_id) return null
  if (!payload.event_id || !e.user || !e.channel || !e.ts) return null
  return {
    eventId: payload.event_id,
    user: e.user,
    channel: e.channel,
    threadTs: e.thread_ts ?? e.ts,
  }
}
