import { describe, expect, it } from "vitest"

import { hasBetterAuthSessionCookie } from "../session-cookie"

describe("hasBetterAuthSessionCookie", () => {
  it("detects Better Auth session cookies", () => {
    expect(hasBetterAuthSessionCookie("better-auth.session_token=abc")).toBe(
      true
    )
    expect(
      hasBetterAuthSessionCookie("__Secure-better-auth.session_token=abc")
    ).toBe(true)
    expect(
      hasBetterAuthSessionCookie("theme=dark; better-auth-session_token=abc")
    ).toBe(true)
  })

  it("rejects missing or empty session cookies", () => {
    expect(hasBetterAuthSessionCookie(null)).toBe(false)
    expect(hasBetterAuthSessionCookie("theme=dark")).toBe(false)
    expect(hasBetterAuthSessionCookie("better-auth.session_token=")).toBe(false)
  })
})
