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
  InvitationAcceptance,
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

  it("returns to the invitation after verifying a magic link or hitting an error", async () => {
    const signInMagicLink = vi.fn(async () => ({}))

    await expect(
      getMagicLinkStatus(signInMagicLink, "person@example.com", "invite&test")
    ).resolves.toBe("sent")
    expect(signInMagicLink).toHaveBeenCalledWith({
      email: "person@example.com",
      callbackURL: "/login?invitationId=invite%26test",
      errorCallbackURL: "/login?invitationId=invite%26test",
    })
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
    expect(
      screen
        .getByRole("link", { name: "About LinearDesk" })
        .getAttribute("href")
    ).toBe("/about")
  })

  it("tells users they can close the tab after requesting a magic link", async () => {
    const signInMagicLink = vi.fn(async () => ({}))

    renderLoginRoute({ signInMagicLink })
    fireEvent.input(screen.getByLabelText(/work email/i), {
      target: { value: "person@example.com" },
    })
    fireEvent.click(
      screen.getByRole("button", { name: /email me a sign-in link/i })
    )

    await waitFor(() => {
      expect(
        screen.getByText(
          /if this address has access, you’ll receive a sign-in link/i
        )
      ).toBeTruthy()
    })
  })

  it("returns to the invitation after Google sign-in", async () => {
    const signInSocial = vi.fn(async () => ({}))
    renderLoginRoute({ invitationId: "invite-123", signInSocial })

    fireEvent.click(
      screen.getByRole("button", { name: /continue with google/i })
    )

    await waitFor(() => {
      expect(signInSocial).toHaveBeenCalledWith({
        provider: "google",
        callbackURL: "/login?invitationId=invite-123",
        errorCallbackURL: "/login?invitationId=invite-123",
      })
    })
  })

  it("shows which account will accept and allows switching after a failure", async () => {
    const accept = vi.fn(async () => {
      throw new Error("The recipient did not match")
    })
    const signOut = vi.fn(async () => undefined)
    render(
      createElement(InvitationAcceptance, {
        email: "other@example.com",
        accept,
        signOut,
      })
    )

    expect(screen.getByText("other@example.com")).toBeTruthy()
    expect(accept).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: /accept invitation/i }))

    expect((await screen.findByRole("alert")).textContent).toMatch(
      /could not be accepted/i
    )
    fireEvent.click(
      screen.getByRole("button", { name: /use a different email/i })
    )
    expect(signOut).toHaveBeenCalledOnce()
  })
})

function renderLoginRoute(
  props: Partial<Parameters<typeof LoginScreen>[0]> = {}
) {
  render(createElement(LoginScreen, props))
}
