import { AsyncLocalStorage } from "node:async_hooks"
import { createHmac } from "node:crypto"

import { betterAuth, getCurrentAdapter } from "better-auth"
import type {
  BetterAuthOptions,
  DBTransactionAdapter,
  ValidateUserInfoOAuthInfo,
} from "better-auth"
import { APIError, createAuthMiddleware } from "better-auth/api"
import {
  magicLink,
  organization as organizationPlugin,
} from "better-auth/plugins"
import type { MagicLinkOptions } from "better-auth/plugins"
import { Pool } from "pg"

import { pgPoolConfig } from "./db/client"
import { createEmailSender } from "./email"
import type { EmailSender } from "./email"
import { withOrganizationInvitationLock } from "./org-access"
import type { AppConfig, AuthBridge, AuthSession } from "./types"

const acceptInvitationPath = "/organization/accept-invitation"
const lockedInvitation = new AsyncLocalStorage<string>()

const requireLockedInvitation = createAuthMiddleware(async (ctx) => {
  if (ctx.path !== acceptInvitationPath) return

  const id = lockedInvitation.getStore()
  if (!id || id !== ctx.body?.invitationId) {
    throw new APIError("BAD_REQUEST", { code: "INVITATION_NOT_FOUND" })
  }
})

export type CreateAuthBridgeOptions = {
  withInvitationLock?: typeof withOrganizationInvitationLock
  emailSender?: EmailSender
  database?: BetterAuthOptions["database"]
}

export function createAuthBridge(
  config: AppConfig,
  options: CreateAuthBridgeOptions = {}
): AuthBridge {
  const emailSender = options.emailSender ?? createEmailSender(config.email)

  const auth = betterAuth({
    database: options.database ?? new Pool(pgPoolConfig(config.databaseUrl)),
    // Invalidate pre-pilot sessions using the existing configured secret.
    secret: createHmac("sha256", config.betterAuthSecret)
      .update("lineardesk:auth:invite-only:v1")
      .digest("hex"),
    baseURL: config.betterAuthUrl,
    disabledPaths: [
      "/organization/create",
      "/organization/update",
      "/organization/delete",
      "/organization/invite-member",
      "/organization/cancel-invitation",
      "/organization/remove-member",
      "/organization/update-member-role",
      "/organization/leave",
    ],
    hooks: { before: requireLockedInvitation },
    plugins: [
      organizationPlugin({
        allowUserToCreateOrganization: false,
        requireEmailVerificationOnInvitation: true,
      }),
      magicLink({
        expiresIn: 300,
        storeToken: "hashed",
        sendMagicLink: createMagicLinkDelivery(emailSender),
      }),
    ],
    socialProviders: {
      google: {
        clientId: config.googleClientId,
        clientSecret: config.googleClientSecret,
      },
    },
    user: { validateUserInfo },
    databaseHooks: {
      session: {
        create: {
          before: async (session, ctx) => {
            if (!ctx) return false

            const user = await ctx.context.internalAdapter.findUserById(
              session.userId
            )
            if (user?.emailVerified !== true) return false

            const adapter = await getCurrentAdapter(ctx.context.adapter)
            return canSignIn(adapter, user.email, user.id)
          },
        },
      },
    },
  })

  const getSession: AuthBridge["getSession"] = async (headers) =>
    toAuthSession(await auth.api.getSession({ headers }))

  return {
    handler: wrapInvitationAcceptance(
      auth.handler,
      getSession,
      options.withInvitationLock ?? withOrganizationInvitationLock
    ),
    getSession,
  }
}

function wrapInvitationAcceptance(
  handler: NonNullable<AuthBridge["handler"]>,
  getSession: AuthBridge["getSession"],
  withInvitationLock: typeof withOrganizationInvitationLock
): NonNullable<AuthBridge["handler"]> {
  return async (request) => {
    if (
      request.method !== "POST" ||
      new URL(request.url).pathname !== `/api/auth${acceptInvitationPath}`
    ) {
      return handler(request)
    }

    const input = await request
      .clone()
      .json()
      .catch(() => null)
    const id = input?.invitationId
    if (typeof id !== "string" || !id) return handler(request)

    const session = await getSession(request.headers)
    if (!session) {
      return Response.json({ code: "UNAUTHORIZED" }, { status: 401 })
    }

    const response = await withInvitationLock(
      id,
      session.user.email.toLowerCase(),
      async () => lockedInvitation.run(id, () => handler(request))
    )
    return (
      response ??
      Response.json({ code: "INVITATION_NOT_FOUND" }, { status: 400 })
    )
  }
}

function createMagicLinkDelivery(
  emailSender: EmailSender
): MagicLinkOptions["sendMagicLink"] {
  return async ({ email, url }, ctx) => {
    if (!ctx) return
    const { internalAdapter } = ctx.context
    const normalizedEmail = email.trim().toLowerCase()
    const user = await internalAdapter.findUserByEmail(normalizedEmail)
    const adapter = await getCurrentAdapter(ctx.context.adapter)
    if (await canSignIn(adapter, normalizedEmail, user?.user.id)) {
      await emailSender.sendMagicLink({ email: normalizedEmail, url })
    }
  }
}

type ValidateUserInfo = NonNullable<
  NonNullable<BetterAuthOptions["user"]>["validateUserInfo"]
>

const validateUserInfo: ValidateUserInfo = async ({ user, source }, ctx) => {
  if (typeof user.email !== "string" || user.emailVerified !== true) {
    return { error: "email_verification_required" }
  }
  if (source.method === "oauth") {
    if (!hasAuthoritativeGoogleEmail(user.email, source.oauth)) {
      return { error: "use_email_link" }
    }
    if (source.action !== "create-user") {
      const storedUser = user.id
        ? await ctx.context.internalAdapter.findUserById(user.id)
        : null
      if (storedUser?.email !== user.email) {
        return { error: "use_email_link" }
      }
    }
  }
  if (
    source.action === "create-user" &&
    !(await hasPendingInvitation(
      await getCurrentAdapter(ctx.context.adapter),
      user.email
    ))
  ) {
    return { error: "invitation_required" }
  }
}

async function hasPendingInvitation(
  adapter: DBTransactionAdapter,
  email: string
): Promise<boolean> {
  return Boolean(
    await adapter.findOne({
      model: "invitation",
      where: [
        { field: "email", value: email },
        { field: "status", value: "pending" },
        { field: "expiresAt", operator: "gt", value: new Date() },
      ],
    })
  )
}

async function canSignIn(
  adapter: DBTransactionAdapter,
  email: string,
  userId?: string
): Promise<boolean> {
  const member = userId
    ? await adapter.findOne({
        model: "member",
        where: [{ field: "userId", value: userId }],
      })
    : null
  return Boolean(member) || hasPendingInvitation(adapter, email)
}

function hasAuthoritativeGoogleEmail(
  email: string,
  oauth: ValidateUserInfoOAuthInfo | undefined
): boolean {
  if (oauth?.providerId !== "google") return false

  // Google's verification of third-party email addresses can be stale.
  const domain = oauth.profile?.hd
  return (
    email.endsWith("@gmail.com") || (typeof domain === "string" && !!domain)
  )
}

export function toAuthSession(value: unknown): AuthSession | null {
  if (!value || typeof value !== "object") return null

  const session = value as {
    session?: {
      activeOrganizationId?: unknown
      token?: unknown
    }
    user?: {
      id?: unknown
      email?: unknown
      emailVerified?: unknown
      name?: unknown
    }
  }

  if (
    typeof session.user?.id !== "string" ||
    typeof session.user.email !== "string" ||
    session.user.emailVerified !== true
  ) {
    return null
  }

  return {
    user: {
      id: session.user.id,
      email: session.user.email,
      name: typeof session.user.name === "string" ? session.user.name : null,
    },
    activeOrganizationId:
      typeof session.session?.activeOrganizationId === "string"
        ? session.session.activeOrganizationId
        : null,
    sessionToken:
      typeof session.session?.token === "string" ? session.session.token : null,
  }
}
