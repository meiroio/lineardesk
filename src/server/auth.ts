import process from "node:process"

import { betterAuth } from "better-auth"
import {
  magicLink,
  organization as organizationPlugin,
} from "better-auth/plugins"
import { Pool } from "pg"

import { pgPoolConfig } from "./db/client"
import { createEmailSender } from "./email"
import type { EmailSender } from "./email"
import { createOrgAccessRepository } from "./org-access"
import type {
  AppConfig,
  AuthBridge,
  AuthSession,
  OrgAccessRepository,
} from "./types"

export type CreateAuthBridgeOptions = {
  orgAccess?: Pick<OrgAccessRepository, "findActiveOrganizationForEmail">
  emailSender?: EmailSender
}

export function createAuthBridge(
  config: AppConfig,
  options: CreateAuthBridgeOptions = {}
): AuthBridge {
  const orgAccess = options.orgAccess ?? createOrgAccessRepository()
  const emailSender = options.emailSender ?? createEmailSender(config.email)

  async function sendMagicLink(email: string, url: string) {
    const matchingOrganization =
      await orgAccess.findActiveOrganizationForEmail(email)
    if (!matchingOrganization) return

    await emailSender.sendMagicLink({ email, url })
  }

  const baseUrl = config.betterAuthUrl.replace(/\/+$/, "")
  const auth = betterAuth({
    database: new Pool(pgPoolConfig(config.databaseUrl)),
    secret: config.betterAuthSecret,
    baseURL: config.betterAuthUrl,
    plugins: [
      organizationPlugin({
        allowUserToCreateOrganization: false,
        requireEmailVerificationOnInvitation: true,
        sendInvitationEmail: async (data) => {
          await emailSender.sendInvitation({
            email: data.email,
            url: `${baseUrl}/login?invitationId=${encodeURIComponent(data.id)}`,
            inviterName: data.inviter.user.name,
            organizationName: data.organization.name,
            role: data.role,
          })
        },
      }),
      magicLink({
        expiresIn: 300,
        storeToken: "hashed",
        sendMagicLink: async (data) => {
          await sendMagicLink(data.email, data.url)
        },
      }),
    ],
    socialProviders: {
      google: {
        clientId: config.googleClientId,
        clientSecret: config.googleClientSecret,
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            const matchingOrganization =
              await orgAccess.findActiveOrganizationForEmail(user.email)
            if (!matchingOrganization) {
              throw new Error("Email domain is not allowed")
            }

            return { data: user }
          },
        },
      },
    },
  })

  const bridge: AuthBridge = {
    handler: (request) => auth.handler(request),
    getSession: async (headers) => {
      const session = await auth.api.getSession({ headers })
      return toAuthSession(session)
    },
  }

  if (process.env.NODE_ENV === "test" || process.env.VITEST) {
    bridge.sendMagicLinkForTest = sendMagicLink
  }

  return bridge
}

export function toAuthSession(value: unknown): AuthSession | null {
  if (!value || typeof value !== "object") return null

  const session = value as {
    session?: {
      activeOrganizationId?: unknown
      token?: unknown
    }
    user?: {
      id?: unknown
      email?: unknown
      name?: unknown
    }
  }

  if (
    typeof session.user?.id !== "string" ||
    typeof session.user.email !== "string"
  ) {
    return null
  }

  return {
    user: {
      id: session.user.id,
      email: session.user.email,
      name: typeof session.user.name === "string" ? session.user.name : null,
    },
    activeOrganizationId:
      typeof session.session?.activeOrganizationId === "string"
        ? session.session.activeOrganizationId
        : null,
    sessionToken:
      typeof session.session?.token === "string" ? session.session.token : null,
  }
}
