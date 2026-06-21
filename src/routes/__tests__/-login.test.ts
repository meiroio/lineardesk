// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { createElement } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  getMagicLinkStatus,
  isCurrentMagicLinkRequest,
  LoginScreen,
  parseLoginReason,
} from "../login"

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

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

describe("login route UI", () => {
  it("does not render a back-to-requests link on the login screen", () => {
    renderLoginRoute()

    expect(screen.queryByRole("link", { name: /back to requests/i })).toBeNull()
  })

  it("tells users they can close the tab after requesting a magic link", async () => {
    const signInMagicLink = vi.fn(async () => ({}))

    renderLoginRoute({ signInMagicLink })
    fireEvent.change(screen.getByLabelText(/work email/i), {
      target: { value: "person@example.com" },
    })
    fireEvent.click(
      screen.getByRole("button", { name: /email me a sign-in link/i })
    )

    await waitFor(() => {
      expect(
        screen.getByText(
          /you can close this tab, your login link is in the email/i
        )
      ).toBeTruthy()
    })
  })
})

function renderLoginRoute(
  props: Partial<Parameters<typeof LoginScreen>[0]> = {}
) {
  render(createElement(LoginScreen, props))
}
