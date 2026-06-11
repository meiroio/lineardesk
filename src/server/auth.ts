import { betterAuth } from "better-auth"
import { Pool } from "pg"

import { isAllowedEmail } from "./config"
import { pgPoolConfig } from "./db/client"
import type { AppConfig, AuthBridge, AuthSession } from "./types"

export function createAuthBridge(config: AppConfig): AuthBridge {
  const auth = betterAuth({
    database: new Pool(pgPoolConfig(config.databaseUrl)),
    secret: config.betterAuthSecret,
    baseURL: config.betterAuthUrl,
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
            if (!isAllowedEmail(user.email, config.allowedEmailDomains)) {
              throw new Error("Email domain is not allowed")
            }

            return { data: user }
          },
        },
      },
    },
  })

  return {
    handler: (request) => auth.handler(request),
    getSession: async (headers) => {
      const session = await auth.api.getSession({ headers })
      return toAuthSession(session)
    },
  }
}

function toAuthSession(value: unknown): AuthSession | null {
  if (!value || typeof value !== "object") return null

  const session = value as {
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
  }
}
