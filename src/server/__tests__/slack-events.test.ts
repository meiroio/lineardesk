import { describe, expect, it } from "vitest"

import { extractMention, isUrlVerification } from "../slack/events"

describe("isUrlVerification", () => {
  it("detects the handshake", () => {
    expect(isUrlVerification({ type: "url_verification", challenge: "c" })).toBe(true)
    expect(isUrlVerification({ type: "event_callback" })).toBe(false)
  })
})

describe("extractMention", () => {
  const base = {
    event_id: "Ev1",
    event: {
      type: "app_mention",
      user: "U1",
      channel: "C1",
      ts: "1.1",
      thread_ts: "1.0",
    },
  }
  it("pulls eventId + channel + thread root + user", () => {
    expect(extractMention(base)).toEqual({
      eventId: "Ev1",
      user: "U1",
      channel: "C1",
      threadTs: "1.0",
    })
  })
  it("falls back to ts when not in a thread", () => {
    expect(
      extractMention({ ...base, event: { ...base.event, thread_ts: undefined } })?.threadTs
    ).toBe("1.1")
  })
  it("returns null for bot messages and non-mentions", () => {
    expect(extractMention({ event_id: "E", event: { type: "app_mention", bot_id: "B1", user: "U1", channel: "C1", ts: "1.1" } })).toBeNull()
    expect(extractMention({ event_id: "E", event: { type: "message", user: "U1", channel: "C1", ts: "1.1" } })).toBeNull()
  })
})
