import { describe, expect, it } from "vitest"

import { readAppConfig } from "../config"

const base = {
  DATABASE_URL: "postgres://x@localhost:5432/x",
  BETTER_AUTH_SECRET: "s",
  BETTER_AUTH_URL: "http://localhost:3000",
  GOOGLE_CLIENT_ID: "g",
  GOOGLE_CLIENT_SECRET: "gs",
  LINEAR_API_KEY: "lin",
  LINEAR_WEBHOOK_SECRET: "wh",
}

describe("readAppConfig email", () => {
  it("uses the local log email provider by default", () => {
    expect(readAppConfig(base).email).toEqual({
      provider: "log",
      appName: "LinearDesk",
      from: "LinearDesk <noreply@lineardesk.local>",
    })
  })

  it("enables Resend when RESEND_API_KEY is present", () => {
    expect(
      readAppConfig({
        ...base,
        RESEND_API_KEY: "re_123",
        EMAIL_FROM: "LinearDesk <support@example.com>",
        EMAIL_APP_NAME: "Desk",
      }).email
    ).toEqual({
      provider: "resend",
      appName: "Desk",
      from: "LinearDesk <support@example.com>",
      resendApiKey: "re_123",
    })
  })

  it("rejects EMAIL_PROVIDER=resend without a key", () => {
    expect(() =>
      readAppConfig({ ...base, EMAIL_PROVIDER: "resend" })
    ).toThrow("RESEND_API_KEY")
  })
})

describe("readAppConfig", () => {
  it("uses the Linear Base defaults from the implementation plan", () => {
    const config = readAppConfig({
      DATABASE_URL:
        "postgres://lineardesk:lineardesk@localhost:5432/lineardesk",
      BETTER_AUTH_SECRET: "test-secret",
      BETTER_AUTH_URL: "http://localhost:3000",
      GOOGLE_CLIENT_ID: "google-id",
      GOOGLE_CLIENT_SECRET: "google-secret",
      LINEAR_API_KEY: "lin_api_key",
      LINEAR_WEBHOOK_SECRET: "webhook-secret",
    })

    expect(config.linear.teamId).toBe("87e7afa0-8d4c-4c43-86a5-090799f403b9")
    expect(config.linear.teamKey).toBe("BAS")
    expect(config.linear.initialStateName).toBe("Triage")
    expect(config.linear.labelName).toBe("Bug")
  })
})

describe("readAppConfig slack", () => {
  it("omits slack when env is absent", () => {
    expect(readAppConfig(base).slack).toBeUndefined()
  })

  it("includes slack when both vars are present", () => {
    const config = readAppConfig({
      ...base,
      SLACK_SIGNING_SECRET: "sign",
      SLACK_BOT_TOKEN: "xoxb-1",
    })
    expect(config.slack).toEqual({ signingSecret: "sign", botToken: "xoxb-1" })
  })
})

describe("readAppConfig gemini", () => {
  it("omits gemini when GEMINI_API_KEY is absent", () => {
    expect(readAppConfig(base).gemini).toBeUndefined()
  })

  it("includes gemini with a default model when the key is present", () => {
    expect(readAppConfig({ ...base, GEMINI_API_KEY: "g-key" }).gemini).toEqual({
      apiKey: "g-key",
      model: "gemini-3.5-flash",
    })
  })

  it("honors GEMINI_MODEL override", () => {
    const config = readAppConfig({
      ...base,
      GEMINI_API_KEY: "g-key",
      GEMINI_MODEL: "gemini-2.0-flash",
    })
    expect(config.gemini?.model).toBe("gemini-2.0-flash")
  })
})
