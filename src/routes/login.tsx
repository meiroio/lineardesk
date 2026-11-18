import { createFileRoute } from "@tanstack/react-router"
import { RiGoogleFill } from "@remixicon/react"
import { useRef, useState } from "react"
import type { ReactNode } from "react"

import { Logo } from "@/components/logo"
import { ThemeToggle } from "@/components/theme-toggle"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { PortalAuthClient } from "@/lib/app-context"
import { authClient } from "@/lib/auth-client"

const loginReasonValues = [
  "forbidden",
  "forbidden_org",
  "multiple_organizations",
  "unauthorized",
] as const

type LoginReason = (typeof loginReasonValues)[number]

type LoginSearch = {
  reason?: LoginReason
  invitationId?: string
  error?: string
}

type SignInMagicLink = PortalAuthClient["signIn"]["magicLink"]
type SignInSocial = PortalAuthClient["signIn"]["social"]

type MagicLinkRequestState = {
  requestId: number
  activeRequestId: number
  submittedEmail: string
  currentEmail: string
}

type LoginScreenProps = {
  reason?: LoginReason
  invitationId?: string
  signInFailed?: boolean
  signInMagicLink?: SignInMagicLink
  signInSocial?: SignInSocial
}

export function parseLoginReason(reason: unknown): LoginReason | undefined {
  return loginReasonValues.includes(reason as LoginReason)
    ? (reason as LoginReason)
    : undefined
}

export async function getMagicLinkStatus(
  signInMagicLink: SignInMagicLink,
  email: string,
  invitationId?: string
): Promise<"sent" | "error"> {
  const loginPath = invitationId ? invitationPath(invitationId) : "/login"
  try {
    const result = await signInMagicLink({
      email,
      callbackURL: invitationId ? loginPath : "/",
      errorCallbackURL: loginPath,
    })
    return result?.error ? "error" : "sent"
  } catch {
    return "error"
  }
}

export function isCurrentMagicLinkRequest({
  requestId,
  activeRequestId,
  submittedEmail,
  currentEmail,
}: MagicLinkRequestState) {
  return requestId === activeRequestId && submittedEmail === currentEmail
}

export const Route = createFileRoute("/login")({
  validateSearch: (search): LoginSearch => ({
    reason: parseLoginReason(search.reason),
    invitationId:
      typeof search.invitationId === "string" ? search.invitationId : undefined,
    error: typeof search.error === "string" ? search.error : undefined,
  }),
  component: Login,
})

function Login() {
  const { reason, invitationId, error } = Route.useSearch()
  const { auth } = Route.useRouteContext()
  if (invitationId) {
    return (
      <InvitationLogin
        key={invitationId}
        invitationId={invitationId}
        signInFailed={Boolean(error)}
        signInMagicLink={auth.signIn.magicLink}
        signInSocial={auth.signIn.social}
      />
    )
  }
  return (
    <LoginScreen
      reason={reason}
      signInFailed={Boolean(error)}
      signInMagicLink={auth.signIn.magicLink}
      signInSocial={auth.signIn.social}
    />
  )
}

function invitationPath(invitationId: string) {
  return `/login?${new URLSearchParams({ invitationId })}`
}

function InvitationLogin({
  invitationId,
  ...props
}: LoginScreenProps & { invitationId: string }) {
  const { data, isPending, error: sessionError } = authClient.useSession()
  if (isPending || sessionError) {
    return (
      <LoginCard title="LinearDesk invitation">
        {sessionError ? (
          <p role="alert">
            Your sign-in could not be checked. Reload to try again.
          </p>
        ) : (
          <p role="status">Checking your sign-in…</p>
        )}
      </LoginCard>
    )
  }

  if (!data) return <LoginScreen invitationId={invitationId} {...props} />

  return (
    <InvitationAcceptance
      email={data.user.email}
      accept={async () => {
        const { error } = await authClient.organization.acceptInvitation({
          invitationId,
        })
        if (error) throw error
        window.location.assign("/")
      }}
      signOut={async () => {
        const { error } = await authClient.signOut()
        if (error) throw error
        window.location.assign(invitationPath(invitationId))
      }}
    />
  )
}

export function InvitationAcceptance({
  email,
  accept,
  signOut,
}: {
  email: string
  accept: () => Promise<void>
  signOut: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  async function submit(action: () => Promise<void>, failureMessage: string) {
    setBusy(true)
    setError(undefined)
    try {
      await action()
    } catch {
      setError(failureMessage)
      setBusy(false)
    }
  }

  return (
    <LoginCard
      title="Accept your invitation"
      description={
        <>
          Signed in as <strong className="break-all">{email}</strong>.
        </>
      }
    >
      <Button
        type="button"
        disabled={busy}
        onClick={() =>
          void submit(
            accept,
            "This invitation could not be accepted. Check that you’re signed in with the invited email, or ask your support contact for a new invitation."
          )
        }
      >
        Accept invitation
      </Button>
      <Button
        type="button"
        variant="secondary"
        disabled={busy}
        onClick={() => void submit(signOut, "Could not sign out. Try again.")}
      >
        Use a different email
      </Button>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </LoginCard>
  )
}

export function LoginScreen({
  reason,
  invitationId,
  signInFailed,
  signInMagicLink = authClient.signIn.magicLink,
  signInSocial = authClient.signIn.social,
}: LoginScreenProps) {
  const [email, setEmail] = useState("")
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">(
    "idle"
  )
  const [socialError, setSocialError] = useState(false)
  const emailRef = useRef(email)
  const magicLinkRequestIdRef = useRef(0)
  const isForbiddenReason = reason === "forbidden" || reason === "forbidden_org"
  const loginPath = invitationId ? invitationPath(invitationId) : "/login"

  return (
    <LoginCard
      title={invitationId ? "Join LinearDesk" : "Sign in to LinearDesk"}
      description={
        invitationId
          ? "Sign in with the email address on your invitation."
          : "Use the email address you were invited with."
      }
    >
      {reason === "multiple_organizations" ? (
        <Alert>
          <AlertTitle>Choose an organization</AlertTitle>
          <AlertDescription>
            Your account belongs to more than one organization. Organization
            switching is not enabled for this portal yet.
          </AlertDescription>
        </Alert>
      ) : isForbiddenReason ? (
        <Alert variant="destructive">
          <AlertTitle>Access not approved</AlertTitle>
          <AlertDescription>
            This email is not approved for LinearDesk portal access.
          </AlertDescription>
        </Alert>
      ) : null}
      {signInFailed || socialError ? (
        <Alert variant="destructive">
          <AlertTitle>Could not sign in</AlertTitle>
          <AlertDescription>
            Try requesting a new sign-in link for your invited email.
          </AlertDescription>
        </Alert>
      ) : null}
      <Button
        type="button"
        onClick={() => {
          setSocialError(false)
          void signInSocial({
            provider: "google",
            callbackURL: invitationId ? loginPath : "/",
            errorCallbackURL: loginPath,
          }).then(
            (result) => setSocialError(Boolean(result?.error)),
            () => setSocialError(true)
          )
        }}
      >
        <RiGoogleFill className="size-4" aria-hidden />
        Continue with Google
      </Button>
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          const submittedEmail = email
          const requestId = magicLinkRequestIdRef.current + 1
          emailRef.current = submittedEmail
          magicLinkRequestIdRef.current = requestId
          setStatus("sending")
          void getMagicLinkStatus(
            signInMagicLink,
            submittedEmail,
            invitationId
          ).then((nextStatus) => {
            if (
              isCurrentMagicLinkRequest({
                requestId,
                activeRequestId: magicLinkRequestIdRef.current,
                submittedEmail,
                currentEmail: emailRef.current,
              })
            ) {
              setStatus(nextStatus)
            }
          })
        }}
      >
        <div className="flex flex-col gap-2">
          <Label htmlFor="email">Work email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(event) => {
              const nextEmail = event.target.value
              emailRef.current = nextEmail
              magicLinkRequestIdRef.current += 1
              setEmail(nextEmail)
              setStatus((current) => (current === "idle" ? current : "idle"))
            }}
            required
          />
        </div>
        <Button
          type="submit"
          variant="secondary"
          disabled={status === "sending"}
        >
          {status === "sending" ? "Sending link..." : "Email me a sign-in link"}
        </Button>
        {status === "sent" ? (
          <p
            className="text-sm text-muted-foreground"
            role="status"
            aria-live="polite"
          >
            If this address has access, you’ll receive a sign-in link. You can
            close this tab.
          </p>
        ) : null}
        {status === "error" ? (
          <p className="text-sm text-destructive" role="alert">
            The sign-in link could not be sent. Try again in a moment.
          </p>
        ) : null}
      </form>
    </LoginCard>
  )
}

function LoginCard({
  title,
  description,
  children,
}: {
  title: string
  description?: ReactNode
  children: ReactNode
}) {
  return (
    <main className="relative flex min-h-svh flex-col items-center justify-center gap-6 bg-background px-4 py-10">
      <ThemeToggle className="absolute top-4 right-4" />
      <Logo className="size-12" />
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          {description ? (
            <CardDescription>{description}</CardDescription>
          ) : null}
        </CardHeader>
        <CardContent className="flex flex-col gap-3">{children}</CardContent>
      </Card>
    </main>
  )
}
