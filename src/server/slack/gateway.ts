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

  return {
    async openView(triggerId, view) {
      await call("views.open", { trigger_id: triggerId, view })
    },
    async postMessage(input) {
      const data = await call<{ ts: string; channel: string }>(
        "chat.postMessage",
        { channel: input.channel, thread_ts: input.threadTs, text: input.text }
      )
      return { channel: data.channel, ts: data.ts }
    },
    async getUserEmail(userId) {
      const data = await call<{ user: { profile?: { email?: string } } }>(
        "users.info",
        { user: userId }
      )
      return data.user.profile?.email ?? null
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
