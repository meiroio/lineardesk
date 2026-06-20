import { describe, expect, it, vi } from "vitest"

import {
  getMagicLinkStatus,
  isCurrentMagicLinkRequest,
  parseLoginReason,
} from "../login"

describe("login route helpers", () => {
  it("treats resolved Better Auth magic-link errors as failed sends", async () => {
    const signInMagicLink = vi.fn(async () => ({
      data: null,
      error: { message: "Could not send magic link" },
    }))

    await expect(
      getMagicLinkStatus(signInMagicLink, "person@example.com")
    ).resolves.toBe("error")
    expect(signInMagicLink).toHaveBeenCalledWith({
      email: "person@example.com",
      callbackURL: "/",
      errorCallbackURL: "/login",
    })
  })

  it("accepts only known login denial reasons", () => {
    expect(parseLoginReason("forbidden")).toBe("forbidden")
    expect(parseLoginReason("forbidden_org")).toBe("forbidden_org")
    expect(parseLoginReason("multiple_organizations")).toBe(
      "multiple_organizations"
    )
    expect(parseLoginReason("unauthorized")).toBe("unauthorized")
    expect(parseLoginReason("unexpected")).toBeUndefined()
  })

  it("rejects stale magic-link responses after the input or active request changes", () => {
    expect(
      isCurrentMagicLinkRequest({
        requestId: 1,
        activeRequestId: 1,
        submittedEmail: "person@example.com",
        currentEmail: "other@example.com",
      })
    ).toBe(false)
    expect(
      isCurrentMagicLinkRequest({
        requestId: 1,
        activeRequestId: 2,
        submittedEmail: "person@example.com",
        currentEmail: "person@example.com",
      })
    ).toBe(false)
    expect(
      isCurrentMagicLinkRequest({
        requestId: 2,
        activeRequestId: 2,
        submittedEmail: "person@example.com",
        currentEmail: "person@example.com",
      })
    ).toBe(true)
  })
})
