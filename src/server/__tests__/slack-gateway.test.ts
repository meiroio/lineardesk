import { afterEach, describe, expect, it, vi } from "vitest"

import { createSlackGateway } from "../slack/gateway"

afterEach(() => vi.unstubAllGlobals())

describe("Slack thread retrieval", () => {
  it("follows a short page's cursor and keeps later messages and attachments", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          ok: true,
          messages: [{ user: "U1", text: "first" }],
          response_metadata: { next_cursor: "next-page" },
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          ok: true,
          messages: [
            {
              user: "U2",
              text: "latest details",
              files: [
                {
                  id: "F1",
                  name: "shot.png",
                  mimetype: "image/png",
                  url_private: "https://files.slack.com/F1",
                },
              ],
            },
          ],
          response_metadata: { next_cursor: "" },
        })
      )
    vi.stubGlobal("fetch", fetch)

    const result = await createSlackGateway("test").getThreadReplies({
      channel: "C1",
      threadTs: "1.1",
    })

    expect(fetch).toHaveBeenCalledTimes(2)
    expect(new URL(fetch.mock.calls[1][0]).searchParams.get("cursor")).toBe(
      "next-page"
    )
    expect(result.truncated).toBe(false)
    expect(result.messages.map((message) => message.text)).toEqual([
      "first",
      "latest details",
    ])
    expect(result.messages[1].files[0].urlPrivate).toBe(
      "https://files.slack.com/F1"
    )
  })

  it("reports truncation when the message budget is exhausted", async () => {
    const fetch = vi.fn(async () =>
      Response.json({
        ok: true,
        messages: Array.from({ length: 200 }, () => ({ text: "message" })),
        response_metadata: { next_cursor: "more" },
      })
    )
    vi.stubGlobal("fetch", fetch)
    const result = await createSlackGateway("test").getThreadReplies({
      channel: "C1",
      threadTs: "1.1",
    })
    expect(result.messages).toHaveLength(200)
    expect(result.truncated).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it("bounds text sent for drafting and marks a partial message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          ok: true,
          messages: [
            { text: "a".repeat(40_000) },
            { text: "b".repeat(40_000) },
          ],
        })
      )
    )
    const result = await createSlackGateway("test").getThreadReplies({
      channel: "C1",
      threadTs: "1.1",
    })
    expect(result.messages.map((message) => message.text.length)).toEqual([
      40_000, 20_000,
    ])
    expect(result.truncated).toBe(true)
  })
})
