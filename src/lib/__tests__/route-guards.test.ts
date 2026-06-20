import { describe, expect, it, vi } from "vitest"

const getPortalAuthState = vi.fn()
const redirect = vi.fn((options: unknown) => options)

vi.mock("@tanstack/react-router", () => ({
  redirect,
}))

vi.mock("@/server/route-auth", () => ({
  getPortalAuthState,
}))

describe("requirePortalAuth", () => {
  it("redirects unauthenticated users with the auth denial reason", async () => {
    getPortalAuthState.mockResolvedValue({
      authenticated: false,
      reason: "multiple_organizations",
    })

    const { requirePortalAuth } = await import("../route-guards")

    await expect(requirePortalAuth()).rejects.toEqual({
      to: "/login",
      search: { reason: "multiple_organizations" },
    })
    expect(redirect).toHaveBeenCalledWith({
      to: "/login",
      search: { reason: "multiple_organizations" },
    })
  })
})
