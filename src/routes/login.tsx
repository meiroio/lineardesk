import { Link, createFileRoute } from "@tanstack/react-router"
import { RiGoogleFill } from "@remixicon/react"

import { ThemeToggle } from "@/components/theme-toggle"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { authClient } from "@/lib/auth-client"

export const Route = createFileRoute("/login")({ component: Login })

function Login() {
  return (
    <main className="relative flex min-h-svh items-center justify-center bg-background px-4 py-10">
      <ThemeToggle className="absolute top-4 right-4" />
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Sign in to LinearDesk</CardTitle>
          <CardDescription>
            Use Google with your approved work email.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
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
          <Link to="/" className={buttonVariants({ variant: "ghost" })}>
            Back to requests
          </Link>
        </CardContent>
      </Card>
    </main>
  )
}
