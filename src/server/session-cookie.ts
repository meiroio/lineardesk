const betterAuthSessionCookieNames = new Set([
  "better-auth.session_token",
  "better-auth-session_token",
  "__Secure-better-auth.session_token",
  "__Secure-better-auth-session_token",
])

export function hasBetterAuthSessionCookie(
  cookieHeader: string | null | undefined
) {
  if (!cookieHeader) return false

  return cookieHeader.split(";").some((cookie) => {
    const [rawName, ...valueParts] = cookie.trim().split("=")
    const name = rawName.trim()
    const value = valueParts.join("=")

    return Boolean(name && value && betterAuthSessionCookieNames.has(name))
  })
}
