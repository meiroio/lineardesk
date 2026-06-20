import { createAuthClient } from "better-auth/react"
import { magicLinkClient, organizationClient } from "better-auth/client/plugins"

export const authClientOptions = {
  basePath: "/api/auth",
  plugins: [magicLinkClient(), organizationClient()],
} satisfies Parameters<typeof createAuthClient>[0]

export const authClient = createAuthClient(authClientOptions)
