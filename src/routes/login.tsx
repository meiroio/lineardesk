import { Link, createFileRoute } from "@tanstack/react-router"
import { RiGoogleFill } from "@remixicon/react"
import { useState } from "react"

import { Logo } from "@/components/logo"
import { ThemeToggle } from "@/components/theme-toggle"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
  const [email, setEmail] = useState("")
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">(
    "idle"
  )
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
              void authClient.signIn.social({
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
              setStatus("sending")
              void getMagicLinkStatus(authClient.signIn.magicLink, email)
                .then(setStatus)
                .catch(() => setStatus("error"))
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
                  setEmail(event.target.value)
                  setStatus((current) =>
                    current === "sent" || current === "error" ? "idle" : current
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
                If this email is approved, a sign-in link is on its way.
              </p>
            ) : null}
            {status === "error" ? (
              <p className="text-sm text-destructive" role="alert">
                The sign-in link could not be sent. Try again in a moment.
              </p>
            ) : null}
          </form>
          <Link to="/" className={buttonVariants({ variant: "ghost" })}>
            Back to requests
          </Link>
        </CardContent>
      </Card>
    </main>
  )
}
