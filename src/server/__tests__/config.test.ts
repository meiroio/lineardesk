import { describe, expect, it } from "vitest"

import { isAllowedEmail, parseAllowedDomains, readAppConfig } from "../config"

describe("allowed email domains", () => {
  it("normalizes a comma-separated domain list", () => {
    expect(parseAllowedDomains(" Example.com,example.org ,, Acme.IO ")).toEqual(
      ["example.com", "example.org", "acme.io"]
    )
  })

  it("matches email domains case-insensitively", () => {
    expect(isAllowedEmail("Ada@Example.COM", ["example.com"])).toBe(true)
    expect(isAllowedEmail("ada@sub.example.com", ["example.com"])).toBe(false)
  })

  it("rejects invalid emails and domains that are not allow-listed", () => {
    expect(isAllowedEmail("not-an-email", ["example.com"])).toBe(false)
    expect(isAllowedEmail("ada@evil.test", ["example.com"])).toBe(false)
    expect(isAllowedEmail("ada@example.com", [])).toBe(false)
  })
})

describe("readAppConfig", () => {
  it("uses the Linear Base defaults from the implementation plan", () => {
    const config = readAppConfig({
      ALLOWED_EMAIL_DOMAINS: "example.com",
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
