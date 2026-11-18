import { randomUUID } from "node:crypto"
import process from "node:process"
import { fileURLToPath } from "node:url"

import { betterAuth } from "better-auth"
import { magicLink } from "better-auth/plugins"
import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/node-postgres"
import { migrate } from "drizzle-orm/node-postgres/migrator"
import { Pool } from "pg"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import { updateCustomerAccess } from "../../../scripts/manage-customer-access"
import { createAuthBridge, toAuthSession } from "../auth"
import * as schema from "../db/schema"
import type { EmailSender } from "../email"
import {
  createOrgAccessRepository,
  lockOrganizationInvitation,
  resolvePortalOrganization,
  withOrganizationInvitationLock,
} from "../org-access"
import type { AppConfig, AuthBridge } from "../types"

const origin = "https://portal.example"
const config: AppConfig = {
  email: {
    provider: "log",
    appName: "LinearDesk",
    from: "LinearDesk <support@example.com>",
  },
  databaseUrl: "postgres://lineardesk:lineardesk@localhost:5432/lineardesk",
  betterAuthSecret: "test-auth-secret-with-at-least-thirty-two-characters",
  betterAuthUrl: origin,
  googleClientId: "google-client-id",
  googleClientSecret: "google-client-secret",
  linear: {
    clientId: "linear-client",
    clientSecret: "linear-secret",
    teamId: "team-id",
    teamKey: "TEAM",
    initialStateName: "Triage",
    labelName: "Customer",
    webhookSecret: "linear-webhook-secret",
  },
}

describe("toAuthSession", () => {
  const authSession = {
    session: {
      activeOrganizationId: "org_123",
      token: "session_token_123",
    },
    user: {
      id: "user_123",
      email: "ada@example.com",
      emailVerified: true,
      name: "Ada Lovelace",
    },
  }

  it("maps a verified session's active organization and token", () => {
    expect(toAuthSession(authSession)).toEqual({
      user: {
        id: "user_123",
        email: "ada@example.com",
        name: "Ada Lovelace",
      },
      activeOrganizationId: "org_123",
      sessionToken: "session_token_123",
    })
  })

  it("denies a session with an unverified email address", () => {
    expect(
      toAuthSession({
        ...authSession,
        user: { ...authSession.user, emailVerified: false },
      })
    ).toBeNull()
  })
})

const databaseUrl = process.env.LINEARDESK_TEST_DATABASE_URL

function gate() {
  let open!: () => void
  const ready = new Promise<void>((resolve) => {
    open = resolve
  })
  return { open, ready }
}

describe.skipIf(!databaseUrl)("Better Auth customer admission", () => {
  const databaseName = `lineardesk_auth_test_${randomUUID().replaceAll("-", "")}`
  let maintenance: Pool | undefined
  let repositoryPool: Pool | undefined
  let authPool: Pool | undefined
  let created = false
  let db: ReturnType<typeof drizzle<typeof schema>>
  let orgAccess: ReturnType<typeof createOrgAccessRepository>
  let auth: AuthBridge
  const sendMagicLink = vi.fn<EmailSender["sendMagicLink"]>(async () => {})
  const withInvitationLock = vi.fn<typeof withOrganizationInvitationLock>(
    (id, email, handle) => withOrganizationInvitationLock(id, email, handle, db)
  )

  beforeAll(async () => {
    maintenance = new Pool({ connectionString: databaseUrl })
    await maintenance.query(`CREATE DATABASE "${databaseName}"`)
    created = true
    const url = new URL(databaseUrl!)
    url.pathname = `/${databaseName}`
    repositoryPool = new Pool({ connectionString: url.toString() })
    authPool = new Pool({ connectionString: url.toString(), max: 1 })
    db = drizzle(repositoryPool, { schema })
    await migrate(db, {
      migrationsFolder: fileURLToPath(
        new URL("../../../drizzle", import.meta.url)
      ),
    })
    orgAccess = createOrgAccessRepository(db)
    auth = createAuthBridge(config, {
      database: authPool,
      withInvitationLock,
      emailSender: { sendMagicLink, sendInvitation: vi.fn(async () => {}) },
    })
    await db.insert(schema.authOrganizations).values({
      id: "acme",
      name: "Acme",
      slug: "acme",
    })
    await db.insert(schema.organizationEmailDomains).values({
      organizationId: "acme",
      domain: "example.com",
    })
    await db.insert(schema.authUsers).values({
      id: "operator",
      name: "Operator",
      email: "operator@example.com",
      emailVerified: true,
    })
    await db.insert(schema.authMembers).values({
      id: "operator-member",
      organizationId: "acme",
      userId: "operator",
      role: "owner",
    })
  })

  afterAll(async () => {
    await Promise.all([repositoryPool?.end(), authPool?.end()])
    if (created) await maintenance?.query(`DROP DATABASE "${databaseName}"`)
    await maintenance?.end()
  })

  function post(path: string, body: unknown, cookie?: string) {
    const headers = new Headers({ "content-type": "application/json", origin })
    if (cookie) headers.set("cookie", cookie)
    return auth.handler!(
      new Request(`${origin}/api/auth${path}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      })
    )
  }

  async function requestMagicLink(email: string) {
    sendMagicLink.mockClear()
    const response = await post("/sign-in/magic-link", {
      email,
      callbackURL: "/login",
    })
    expect(response.status).toBe(200)
    return sendMagicLink.mock.calls.at(0)?.[0].url
  }

  async function signIn(email: string) {
    const url = await requestMagicLink(email)
    expect(url).toBeDefined()
    return sessionCookie(await auth.handler!(new Request(url!)))
  }

  function sessionCookie(response: Response) {
    expect(response.status).toBe(302)
    const cookie = response.headers
      .getSetCookie()
      .find((value) => value.startsWith("__Secure-better-auth.session_token="))
      ?.split(";")[0]
    expect(cookie).toBeDefined()
    return cookie!
  }

  async function seedInvite(
    email: string,
    expiresAt = new Date(Date.now() + 60_000)
  ) {
    const id = randomUUID()
    await db.insert(schema.authInvitations).values({
      id,
      organizationId: "acme",
      email,
      role: "member",
      expiresAt,
      inviterId: "operator",
    })
    return id
  }

  function accept(invitationId: string, cookie?: string) {
    return post("/organization/accept-invitation", { invitationId }, cookie)
  }

  async function portalOrganization(cookie: string) {
    const session = await auth.getSession(new Headers({ cookie }))
    expect(session).toBeTruthy()
    return resolvePortalOrganization(session!, orgAccess)
  }

  it("rejects pre-pilot session signatures and admits a freshly signed-in invitee", async () => {
    const email = "cutover@example.com"
    const invitationId = await seedInvite(email)
    const previousAuth = betterAuth({
      database: authPool,
      secret: config.betterAuthSecret,
      baseURL: origin,
      plugins: [magicLink({ sendMagicLink, storeToken: "hashed" })],
    })
    sendMagicLink.mockClear()
    await previousAuth.api.signInMagicLink({
      headers: new Headers({ origin }),
      body: { email, callbackURL: "/login" },
    })
    const previousLink = sendMagicLink.mock.calls.at(0)?.[0].url
    expect(previousLink).toBeDefined()
    const oldCookie = sessionCookie(
      await previousAuth.handler(new Request(previousLink!))
    )
    const oldHeaders = new Headers({ cookie: oldCookie })
    expect(
      (await previousAuth.api.getSession({ headers: oldHeaders }))?.user.email
    ).toBe(email)
    expect(await auth.getSession(oldHeaders)).toBeNull()
    expect((await accept(invitationId, oldCookie)).status).toBe(401)

    const freshCookie = await signIn(email)
    expect((await accept(invitationId, freshCookie)).status).toBe(200)
    expect(await portalOrganization(freshCookie)).toEqual({
      status: "ok",
      organizationId: "acme",
    })
  })

  it("admits only the named invitee and requires acceptance before granting portal access", async () => {
    const email = "ada@example.com"
    const invitationId = await seedInvite(email)
    await seedInvite("expired@example.com", new Date(0))

    expect(await requestMagicLink("uninvited@example.com")).toBeUndefined()
    expect(await requestMagicLink("expired@example.com")).toBeUndefined()
    expect((await accept(invitationId)).status).toBe(401)
    expect((await accept("unknown-id")).status).toBe(401)

    const operatorCookie = await signIn("operator@example.com")
    expect(
      (
        await post(
          "/organization/invite-member",
          { email, role: "member" },
          operatorCookie
        )
      ).status
    ).toBe(404)
    const inviteeCookie = await signIn("Ada@Example.com")
    expect(await portalOrganization(inviteeCookie)).toEqual({
      status: "forbidden",
    })
    expect((await accept(invitationId, operatorCookie)).status).toBe(400)
    expect((await accept(invitationId, inviteeCookie)).status).toBe(200)
    expect(await portalOrganization(inviteeCookie)).toEqual({
      status: "ok",
      organizationId: "acme",
    })
    expect((await accept(invitationId, inviteeCookie)).status).toBe(400)

    const unusedLink = await requestMagicLink(email)
    expect(unusedLink).toBeDefined()
    expect(
      await updateCustomerAccess(db, {
        action: "revoke",
        organizationSlug: "acme",
        email,
      })
    ).toMatchObject({ removedMemberships: 1 })
    expect(await portalOrganization(inviteeCookie)).toEqual({
      status: "forbidden",
    })
    expect(await requestMagicLink(email)).toBeUndefined()

    const staleLinkResponse = await auth.handler!(new Request(unusedLink!))
    expect(
      staleLinkResponse.headers
        .getSetCookie()
        .filter((value) =>
          value.startsWith("__Secure-better-auth.session_token=")
        )
    ).toEqual([])
  })

  it("signs in verified staff without an invitation or organization membership", async () => {
    expect(await requestMagicLink("staff@meiro.io.example")).toBeUndefined()
    expect(await requestMagicLink("staff@sub.meiro.io")).toBeUndefined()

    const cookie = await signIn("Staff@Meiro.io")
    const session = await auth.getSession(new Headers({ cookie }))
    expect(session?.user.email).toBe("staff@meiro.io")
    expect(await orgAccess.listMembershipsForUser(session!.user.id)).toEqual([])
  })

  it("verifies the mailbox before allowing a fresh operator to accept a self-invite", async () => {
    const email = "bootstrap@another.example"
    const invitation = await updateCustomerAccess(db, {
      action: "invite",
      organizationSlug: "acme",
      email,
      operatorEmail: email,
    })
    if (invitation.action !== "invite")
      throw new Error("Expected an invitation")

    const cookie = await signIn(email)
    expect(await portalOrganization(cookie)).toEqual({ status: "forbidden" })
    expect((await accept(invitation.invitationId, cookie)).status).toBe(200)
    expect(await portalOrganization(cookie)).toEqual({
      status: "ok",
      organizationId: "acme",
    })
  })

  it("cannot accept an invitation that a concurrent revocation cancels", async () => {
    const email = "bea@example.com"
    const invitationId = await seedInvite(email)
    const cookie = await signIn(email)
    const lockAcquired = gate()
    const cancel = gate()
    const revoke = db.transaction(async (tx) => {
      await lockOrganizationInvitation(tx, "acme", email)
      lockAcquired.open()
      await cancel.ready
      await tx
        .update(schema.authInvitations)
        .set({ status: "canceled" })
        .where(eq(schema.authInvitations.id, invitationId))
    })
    await lockAcquired.ready

    const attempting = gate()
    withInvitationLock.mockImplementationOnce((id, recipientEmail, handle) => {
      attempting.open()
      return withOrganizationInvitationLock(id, recipientEmail, handle, db)
    })
    const acceptance = accept(invitationId, cookie)
    try {
      await Promise.race([attempting.ready, acceptance])
    } finally {
      cancel.open()
    }
    await revoke

    expect((await acceptance).status).toBe(400)
    expect(await portalOrganization(cookie)).toEqual({ status: "forbidden" })
  })
})
