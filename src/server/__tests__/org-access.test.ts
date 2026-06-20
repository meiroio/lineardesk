import { describe, expect, it, vi } from "vitest"

import {
  getEmailDomain,
  isPublicEmailDomain,
  resolvePortalOrganization,
} from "../org-access"
import type { AuthSession, OrgAccessRepository } from "../types"

function makeSession(overrides: Partial<AuthSession> = {}): AuthSession {
  return {
    user: {
      id: "user-1",
      email: "ada@example.com",
      name: "Ada",
    },
    activeOrganizationId: null,
    sessionToken: "session-token",
    ...overrides,
  }
}

function makeOrgAccess(
  overrides: Partial<OrgAccessRepository> = {}
): OrgAccessRepository {
  return {
    findActiveOrganizationForEmail: vi.fn(async () => null),
    ensureMember: vi.fn(async () => undefined),
    listMembershipsForUser: vi.fn(async () => []),
    hasMembership: vi.fn(async () => false),
    setActiveOrganizationForSession: vi.fn(async () => undefined),
    ...overrides,
  }
}

describe("organization access", () => {
  it("extracts and normalizes an email domain", () => {
    expect(getEmailDomain(" Ada@Example.COM ")).toBe("example.com")
  })

  it("returns null for invalid email", () => {
    expect(getEmailDomain("ada.example.com")).toBeNull()
  })

  it("recognizes public email domains", () => {
    expect(isPublicEmailDomain("gmail.com")).toBe(true)
    expect(isPublicEmailDomain("example.com")).toBe(false)
  })

  it("auto-enrolls a domain user and sets the active organization", async () => {
    const orgAccess = makeOrgAccess({
      findActiveOrganizationForEmail: vi.fn(async () => ({
        organizationId: "org-1",
        organizationName: "Example",
        organizationSlug: "example",
        domain: "example.com",
      })),
    })

    await expect(
      resolvePortalOrganization(makeSession(), orgAccess)
    ).resolves.toEqual({ status: "ok", organizationId: "org-1" })
    expect(orgAccess.ensureMember).toHaveBeenCalledWith({
      userId: "user-1",
      organizationId: "org-1",
      role: "member",
    })
    expect(orgAccess.setActiveOrganizationForSession).toHaveBeenCalledWith({
      sessionToken: "session-token",
      organizationId: "org-1",
    })
  })

  it("uses an existing active membership without ensuring membership", async () => {
    const orgAccess = makeOrgAccess({
      hasMembership: vi.fn(async () => true),
    })

    await expect(
      resolvePortalOrganization(
        makeSession({ activeOrganizationId: "org-1" }),
        orgAccess
      )
    ).resolves.toEqual({ status: "ok", organizationId: "org-1" })
    expect(orgAccess.ensureMember).not.toHaveBeenCalled()
    expect(orgAccess.findActiveOrganizationForEmail).not.toHaveBeenCalled()
  })

  it("returns multiple_organizations for multiple memberships without active org", async () => {
    const orgAccess = makeOrgAccess({
      listMembershipsForUser: vi.fn(async () => [
        { organizationId: "org-1", role: "member" },
        { organizationId: "org-2", role: "admin" },
      ]),
    })

    await expect(
      resolvePortalOrganization(makeSession(), orgAccess)
    ).resolves.toEqual({ status: "multiple_organizations" })
  })

  it("returns forbidden without membership or domain access", async () => {
    await expect(
      resolvePortalOrganization(makeSession(), makeOrgAccess())
    ).resolves.toEqual({ status: "forbidden" })
  })
})
