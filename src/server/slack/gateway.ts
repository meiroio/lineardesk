import type { SlackGateway } from "../types"

const API = "https://slack.com/api"

export function createSlackGateway(botToken: string): SlackGateway {
  async function call<T>(method: string, body: unknown): Promise<T> {
    const res = await fetch(`${API}/${method}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${botToken}`,
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`Slack ${method} HTTP ${res.status}`)
    const data = (await res.json()) as { ok: boolean; error?: string } & T
    if (!data.ok) throw new Error(`Slack ${method} failed: ${data.error}`)
    return data
  }

  // Read methods (e.g. users.info) don't parse args from a JSON body — Slack
  // expects them as query params. Sending JSON yields confusing errors like
  // user_not_found because the arg never reaches the API.
  async function callGet<T>(
    method: string,
    params: Record<string, string>
  ): Promise<T> {
    const query = new URLSearchParams(params).toString()
    const res = await fetch(`${API}/${method}?${query}`, {
      headers: { authorization: `Bearer ${botToken}` },
    })
    if (!res.ok) throw new Error(`Slack ${method} HTTP ${res.status}`)
    const data = (await res.json()) as { ok: boolean; error?: string } & T
    if (!data.ok) throw new Error(`Slack ${method} failed: ${data.error}`)
    return data
  }

  return {
    async openView(triggerId, view) {
      const data = await call<{ view: { id: string } }>("views.open", {
        trigger_id: triggerId,
        view,
      })
      return data.view.id
    },
    async updateView(viewId, view) {
      await call("views.update", { view_id: viewId, view })
    },
    async postMessage(input) {
      const data = await call<{ ts: string; channel: string }>(
        "chat.postMessage",
        { channel: input.channel, thread_ts: input.threadTs, text: input.text }
      )
      return { channel: data.channel, ts: data.ts }
    },
    async getUserEmail(userId) {
      const data = await callGet<{ user: { profile?: { email?: string } } }>(
        "users.info",
        { user: userId }
      )
      return data.user.profile?.email ?? null
    },
    async getPermalink(input) {
      const data = await callGet<{ permalink: string }>("chat.getPermalink", {
        channel: input.channel,
        message_ts: input.messageTs,
      })
      return data.permalink
    },
    async getThreadReplies(input) {
      const data = await callGet<{
        messages?: { user?: string; text?: string }[]
      }>("conversations.replies", {
        channel: input.channel,
        ts: input.threadTs,
        limit: "200",
      })
      return {
        messages: (data.messages ?? []).map((m) => ({
          user: m.user ?? null,
          text: m.text ?? "",
        })),
      }
    },
    async downloadFile(urlPrivate) {
      const res = await fetch(urlPrivate, {
        headers: { authorization: `Bearer ${botToken}` },
      })
      if (!res.ok) throw new Error(`Slack file download failed: ${res.status}`)
      const contentType =
        res.headers.get("content-type") ?? "application/octet-stream"
      const bytes = new Uint8Array(await res.arrayBuffer())
      return { bytes, contentType }
    },
  }
}
