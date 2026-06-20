import { describe, expect, it, vi } from "vitest"

import type { EmailSender } from "../email"
import * as authModule from "../auth"
import type { AppConfig, OrgAccessRepository } from "../types"

const config: AppConfig = {
  email: {
    provider: "log",
    appName: "LinearDesk",
    from: "LinearDesk <support@example.com>",
  },
  databaseUrl: "postgres://lineardesk:lineardesk@localhost:5432/lineardesk",
  betterAuthSecret: "test-secret",
  betterAuthUrl: "https://portal.example/",
  googleClientId: "google-client-id",
  googleClientSecret: "google-client-secret",
  linear: {
    apiKey: "lin_api_key",
    teamId: "team-id",
    teamKey: "TEAM",
    initialStateName: "Triage",
    labelName: "Customer",
    webhookSecret: "linear-webhook-secret",
  },
}

describe("toAuthSession", () => {
  it("maps active organization id and session token", () => {
    const { toAuthSession } = authModule
    expect(toAuthSession).toBeTypeOf("function")

    expect(
      toAuthSession({
        session: {
          activeOrganizationId: "org_123",
          token: "session_token_123",
        },
        user: {
          id: "user_123",
          email: "ada@example.com",
          name: "Ada Lovelace",
        },
      })
    ).toEqual({
      user: {
        id: "user_123",
        email: "ada@example.com",
        name: "Ada Lovelace",
      },
      activeOrganizationId: "org_123",
      sessionToken: "session_token_123",
    })
  })
})

describe("createAuthBridge", () => {
  it("does not send a magic link for an unapproved email domain", async () => {
    const findActiveOrganizationForEmail = vi.fn<
      OrgAccessRepository["findActiveOrganizationForEmail"]
    >(async () => null)
    const emailSender: EmailSender = {
      sendMagicLink: vi.fn<EmailSender["sendMagicLink"]>(async () => {}),
      sendInvitation: vi.fn<EmailSender["sendInvitation"]>(async () => {}),
    }

    const auth = authModule.createAuthBridge(config, {
      orgAccess: { findActiveOrganizationForEmail },
      emailSender,
    })

    const { sendMagicLinkForTest } = auth
    if (!sendMagicLinkForTest) {
      throw new Error("Expected test auth bridge to expose magic-link sender")
    }
    await sendMagicLinkForTest(
      "person@unapproved.test",
      "https://portal.example/api/auth/magic-link"
    )

    expect(findActiveOrganizationForEmail).toHaveBeenCalledWith(
      "person@unapproved.test"
    )
    expect(emailSender.sendMagicLink).not.toHaveBeenCalled()
  })
})
