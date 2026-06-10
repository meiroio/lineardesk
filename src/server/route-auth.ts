import { createServerFn } from "@tanstack/react-start"
import { getRequestHeaders } from "@tanstack/react-start/server"

import { createAuthBridge } from "./auth"
import { isAllowedEmail, readAppConfig } from "./config"
import { hasBetterAuthSessionCookie } from "./session-cookie"
import type { AppConfig, AuthBridge } from "./types"

let cachedAuth: { key: string; auth: AuthBridge } | null = null

export const getPortalAuthState = createServerFn({ method: "GET" }).handler(
  async () => {
    const headers = getRequestHeaders()
    if (!hasBetterAuthSessionCookie(headers.get("cookie")))
      return { authenticated: false }

    const config = readAppConfig()
    const session = await getAuthBridge(config).getSession(headers)

    return {
      authenticated: Boolean(
        session &&
        isAllowedEmail(session.user.email, config.allowedEmailDomains)
      ),
    }
  }
)

function getAuthBridge(config: AppConfig) {
  const key = [
    config.databaseUrl,
    config.betterAuthSecret,
    config.betterAuthUrl,
    config.googleClientId,
    config.googleClientSecret,
    config.allowedEmailDomains.join(","),
  ].join("\0")

  if (!cachedAuth || cachedAuth.key !== key) {
    cachedAuth = {
      key,
      auth: createAuthBridge(config),
    }
  }

  return cachedAuth.auth
}
