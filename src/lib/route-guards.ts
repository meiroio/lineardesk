import { redirect } from "@tanstack/react-router"

import { getPortalAuthState } from "@/server/route-auth"

export async function requirePortalAuth() {
  const auth = await getPortalAuthState()
  if (!auth.authenticated) throw redirect({ to: "/login" })
}
