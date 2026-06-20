import { beforeEach, describe, expect, it, vi } from "vitest"

import type { AppConfig, AuthBridge, AuthSession } from "../types"

const config: AppConfig = {
  email: {
    provider: "log",
    appName: "LinearDesk",
    from: "LinearDesk <noreply@lineardesk.local>",
  },
  databaseUrl: "postgres://lineardesk:lineardesk@localhost:5432/lineardesk",
  betterAuthSecret: "test-secret",
  betterAuthUrl: "http://localhost:3000",
  googleClientId: "google-id",
  googleClientSecret: "google-secret",
  linear: {
    apiKey: "lin_api_key",
    teamId: "team-id",
    teamKey: "BAS",
    initialStateName: "Triage",
    labelName: "Bug",
    webhookSecret: "webhook-secret",
  },
}

const session: AuthSession = {
  user: {
    id: "user-id",
    email: "person@example.com",
    name: "Person Example",
  },
  activeOrganizationId: null,
  sessionToken: "session-token",
}

const getSession = vi.fn<AuthBridge["getSession"]>()
const authBridge: AuthBridge = { getSession }
const createAuthBridge = vi.fn(() => authBridge)
const readAppConfig = vi.fn(() => config)
const hasBetterAuthSessionCookie = vi.fn(() => true)
const orgAccess = {
  findActiveOrganizationForEmail: vi.fn(),
  ensureMember: vi.fn(),
  listMembershipsForUser: vi.fn(),
  hasMembership: vi.fn(),
  setActiveOrganizationForSession: vi.fn(),
}
const createOrgAccessRepository = vi.fn(() => orgAccess)
const resolvePortalOrganization = vi.fn()
let requestHeaders = new Headers()

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    handler: (fn: () => unknown) => fn,
  }),
}))

vi.mock("@tanstack/react-start/server", () => ({
  getRequestHeaders: () => requestHeaders,
}))

vi.mock("../auth", () => ({
  createAuthBridge,
}))

vi.mock("../config", () => ({
  readAppConfig,
}))

vi.mock("../session-cookie", () => ({
  hasBetterAuthSessionCookie,
}))

vi.mock("../org-access", () => ({
  createOrgAccessRepository,
  resolvePortalOrganization,
}))

describe("getPortalAuthState", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requestHeaders = new Headers({
      cookie: "better-auth.session_token=session-token",
    })
    readAppConfig.mockReturnValue(config)
    hasBetterAuthSessionCookie.mockReturnValue(true)
    getSession.mockResolvedValue(session)
    createAuthBridge.mockReturnValue(authBridge)
    createOrgAccessRepository.mockReturnValue(orgAccess)
    resolvePortalOrganization.mockResolvedValue({
      status: "ok",
      organizationId: "org-1",
    })
  })

  it("resolves portal organization access for the active session", async () => {
    const { getPortalAuthState } = await import("../route-auth")

    await expect(getPortalAuthState()).resolves.toEqual({
      authenticated: true,
      organizationId: "org-1",
    })
    expect(getSession).toHaveBeenCalledWith(requestHeaders)
    expect(resolvePortalOrganization).toHaveBeenCalledWith(session, orgAccess)
  })

  it("returns the organization access denial reason", async () => {
    const { getPortalAuthState } = await import("../route-auth")
    resolvePortalOrganization.mockResolvedValue({
      status: "multiple_organizations",
    })

    await expect(getPortalAuthState()).resolves.toEqual({
      authenticated: false,
      reason: "multiple_organizations",
    })
  })

  it("returns unauthorized when the session cookie has no session", async () => {
    const { getPortalAuthState } = await import("../route-auth")
    getSession.mockResolvedValue(null)

    await expect(getPortalAuthState()).resolves.toEqual({
      authenticated: false,
      reason: "unauthorized",
    })
    expect(resolvePortalOrganization).not.toHaveBeenCalled()
  })
})
