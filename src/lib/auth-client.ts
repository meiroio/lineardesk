import { createAuthClient } from "better-auth/react"

export const authClientOptions = {
  basePath: "/api/auth",
} satisfies Parameters<typeof createAuthClient>[0]

export const authClient = createAuthClient(authClientOptions)
