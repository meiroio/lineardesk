import { afterEach, describe, expect, it, vi } from "vitest"

import { createEmailSender } from "../email"

const config = {
  provider: "resend" as const,
  appName: "LinearDesk",
  from: "LinearDesk <support@example.com>",
  resendApiKey: "re_123",
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("createEmailSender", () => {
  it("sends magic links through Resend", async () => {
    const fetchFn = vi.fn(async () => new Response(null, { status: 202 }))
    const sender = createEmailSender(config, fetchFn)

    await sender.sendMagicLink({
      email: "person@example.com",
      url: "https://desk.example.com/auth/magic?token=<abc>",
    })

    expect(fetchFn).toHaveBeenCalledTimes(1)
    const [url, init] = fetchFn.mock.calls[0]
    expect(url).toBe("https://api.resend.com/emails")
    expect(init?.method).toBe("POST")
    expect(init?.headers).toEqual({
      Authorization: "Bearer re_123",
      "Content-Type": "application/json",
    })
    expect(JSON.parse(String(init?.body))).toEqual({
      from: "LinearDesk <support@example.com>",
      to: "person@example.com",
      subject: "Sign in to LinearDesk",
      html:
        '<p>Use this secure link to sign in to LinearDesk.</p><p><a href="https://desk.example.com/auth/magic?token=&lt;abc&gt;">Sign in to LinearDesk</a></p>',
      text:
        "Use this secure link to sign in to LinearDesk:\n\nhttps://desk.example.com/auth/magic?token=<abc>",
    })
  })

  it("throws when Resend returns a non-2xx response", async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(null, { status: 500, statusText: "Internal Server Error" })
    )
    const sender = createEmailSender(config, fetchFn)

    await expect(
      sender.sendMagicLink({
        email: "person@example.com",
        url: "https://desk.example.com/auth/magic",
      })
    ).rejects.toThrow("Resend email failed with 500 Internal Server Error")
  })

  it("logs local emails without calling fetch", async () => {
    const fetchFn = vi.fn()
    const info = vi.spyOn(console, "info").mockImplementation(() => {})
    const sender = createEmailSender(
      {
        provider: "log",
        appName: "LinearDesk",
        from: "LinearDesk <noreply@lineardesk.local>",
      },
      fetchFn
    )

    await sender.sendMagicLink({
      email: "person@example.com",
      url: "https://desk.example.com/auth/magic",
    })

    expect(fetchFn).not.toHaveBeenCalled()
    expect(info).toHaveBeenCalledWith("Email log", {
      from: "LinearDesk <noreply@lineardesk.local>",
      to: "person@example.com",
      subject: "Sign in to LinearDesk",
      text:
        "Use this secure link to sign in to LinearDesk:\n\nhttps://desk.example.com/auth/magic",
    })
  })
})
