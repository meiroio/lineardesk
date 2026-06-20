import { createServerFn } from "@tanstack/react-start"
import { getRequestHeaders } from "@tanstack/react-start/server"

import { createAuthBridge } from "./auth"
import { readAppConfig } from "./config"
import {
  createOrgAccessRepository,
  resolvePortalOrganization,
} from "./org-access"
import { hasBetterAuthSessionCookie } from "./session-cookie"
import type { AppConfig, AuthBridge } from "./types"

let cachedAuth: { key: string; auth: AuthBridge } | null = null

export const getPortalAuthState = createServerFn({ method: "GET" }).handler(
  async () => {
    const headers = getRequestHeaders()
    if (!hasBetterAuthSessionCookie(headers.get("cookie")))
      return { authenticated: false, reason: "unauthorized" as const }

    const config = readAppConfig()
    const session = await getAuthBridge(config).getSession(headers)
    if (!session)
      return { authenticated: false, reason: "unauthorized" as const }

    const resolution = await resolvePortalOrganization(
      session,
      createOrgAccessRepository()
    )

    if (resolution.status !== "ok") {
      return { authenticated: false, reason: resolution.status }
    }

    return {
      authenticated: true,
      organizationId: resolution.organizationId,
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
  ].join("\0")

  if (!cachedAuth || cachedAuth.key !== key) {
    cachedAuth = {
      key,
      auth: createAuthBridge(config),
    }
  }

  return cachedAuth.auth
}
