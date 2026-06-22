import { createFileRoute } from "@tanstack/react-router"
import { RiGoogleFill } from "@remixicon/react"
import { useRef, useState } from "react"

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
}

type MagicLinkInput = {
  email: string
  callbackURL: string
  errorCallbackURL: string
}

type MagicLinkResult = {
  error?: unknown
}

type SignInMagicLink = (
  input: MagicLinkInput
) => Promise<MagicLinkResult | void>

type SignInSocial = (input: {
  provider: "google"
  callbackURL: string
}) => Promise<unknown> | unknown

type MagicLinkRequestState = {
  requestId: number
  activeRequestId: number
  submittedEmail: string
  currentEmail: string
}

type LoginScreenProps = {
  reason?: LoginReason
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
  email: string
): Promise<"sent" | "error"> {
  const result = await signInMagicLink({
    email,
    callbackURL: "/",
    errorCallbackURL: "/login",
  })

  return result?.error ? "error" : "sent"
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
  }),
  component: Login,
})

function Login() {
  const { reason } = Route.useSearch()
  const { auth } = Route.useRouteContext()
  return (
    <LoginScreen
      reason={reason}
      signInMagicLink={auth.signIn.magicLink}
      signInSocial={auth.signIn.social}
    />
  )
}

const missingSignInMagicLink: SignInMagicLink = async () => {
  throw new Error("signInMagicLink dependency was not provided")
}

const missingSignInSocial: SignInSocial = () => {
  throw new Error("signInSocial dependency was not provided")
}

export function LoginScreen({
  reason,
  signInMagicLink = missingSignInMagicLink,
  signInSocial = missingSignInSocial,
}: LoginScreenProps) {
  const [email, setEmail] = useState("")
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">(
    "idle"
  )
  const emailRef = useRef(email)
  const magicLinkRequestIdRef = useRef(0)
  const isForbiddenReason = reason === "forbidden" || reason === "forbidden_org"

  return (
    <main className="relative flex min-h-svh flex-col items-center justify-center gap-6 bg-background px-4 py-10">
      <ThemeToggle className="absolute top-4 right-4" />
      <Logo className="size-12" />
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Sign in to LinearDesk</CardTitle>
          <CardDescription>
            Use Google with your approved work email.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
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
          <Button
            onClick={() =>
              void signInSocial({
                provider: "google",
                callbackURL: "/",
              })
            }
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
              void getMagicLinkStatus(signInMagicLink, submittedEmail)
                .then((nextStatus) => {
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
                .catch(() => {
                  if (
                    isCurrentMagicLinkRequest({
                      requestId,
                      activeRequestId: magicLinkRequestIdRef.current,
                      submittedEmail,
                      currentEmail: emailRef.current,
                    })
                  ) {
                    setStatus("error")
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
                  setStatus((current) =>
                    current === "idle" ? current : "idle"
                  )
                }}
                required
              />
            </div>
            <Button
              type="submit"
              variant="secondary"
              disabled={status === "sending"}
            >
              {status === "sending"
                ? "Sending link..."
                : "Email me a sign-in link"}
            </Button>
            {status === "sent" ? (
              <p
                className="text-sm text-muted-foreground"
                role="status"
                aria-live="polite"
              >
                You can close this tab, your login link is in the email.
              </p>
            ) : null}
            {status === "error" ? (
              <p className="text-sm text-destructive" role="alert">
                The sign-in link could not be sent. Try again in a moment.
              </p>
            ) : null}
          </form>
        </CardContent>
      </Card>
    </main>
  )
}
