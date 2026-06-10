import { Link, createFileRoute, useNavigate } from "@tanstack/react-router"
import {
  RiAddLine,
  RiArrowRightSLine,
  RiErrorWarningLine,
  RiInboxArchiveLine,
  RiLogoutBoxRLine,
} from "@remixicon/react"
import { useEffect, useState } from "react"

import { PageShell } from "@/components/page-shell"
import { SeverityBadge } from "@/components/severity-badge"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { authClient } from "@/lib/auth-client"
import type { PortalRequest } from "@/lib/helpdesk-api"
import {
  ApiError,
  apiGet,
  formatDateTime,
  statusClassName,
} from "@/lib/helpdesk-api"
import { requirePortalAuth } from "@/lib/route-guards"

export const Route = createFileRoute("/")({
  beforeLoad: requirePortalAuth,
  component: Dashboard,
})

function Dashboard() {
  const navigate = useNavigate()
  const [requests, setRequests] = useState<PortalRequest[]>([])
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading")

  useEffect(() => {
    let active = true

    void apiGet<{ requests: PortalRequest[] }>("/api/requests")
      .then((data) => {
        if (!active) return
        setRequests(data.requests)
        setStatus("ready")
      })
      .catch((error) => {
        if (!active) return
        if (error instanceof ApiError && error.status === 401) {
          void navigate({ to: "/login" })
          return
        }

        setStatus("error")
      })

    return () => {
      active = false
    }
  }, [navigate])

  return (
    <PageShell
      eyebrow="LinearDesk"
      title="Requests"
      description="Track the current Linear status for requests you submitted."
      actions={
        <>
          <Link to="/requests/new" className={buttonVariants()}>
            <RiAddLine aria-hidden />
            New request
          </Link>
          <Button
            variant="outline"
            size="icon"
            aria-label="Sign out"
            onClick={() => {
              void authClient
                .signOut()
                .finally(() => navigate({ to: "/login" }))
            }}
          >
            <RiLogoutBoxRLine aria-hidden />
          </Button>
        </>
      }
    >
      {status === "loading" ? (
        <RequestListSkeleton />
      ) : status === "error" ? (
        <Alert variant="destructive">
          <RiErrorWarningLine aria-hidden />
          <AlertTitle>Requests unavailable</AlertTitle>
          <AlertDescription>Try again after a moment.</AlertDescription>
        </Alert>
      ) : requests.length === 0 ? (
        <Empty className="rounded-2xl border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <RiInboxArchiveLine aria-hidden />
            </EmptyMedia>
            <EmptyTitle>No requests yet</EmptyTitle>
            <EmptyDescription>
              Submit a request and it will appear here.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Link to="/requests/new" className={buttonVariants()}>
              <RiAddLine aria-hidden />
              New request
            </Link>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="overflow-hidden rounded-2xl bg-card ring-1 ring-foreground/10">
          <ul className="divide-y">
            {requests.map((request) => (
              <li key={request.id}>
                <Link
                  to="/requests/$requestId"
                  params={{ requestId: request.id }}
                  className="group flex items-center gap-4 px-5 py-4 transition-colors outline-none hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
                >
                  <span className="min-w-0 flex-1 space-y-0.5">
                    <span className="block truncate text-sm font-medium">
                      {request.title}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {request.linearIdentifier} · Updated{" "}
                      {formatDateTime(request.updatedAt)}
                    </span>
                  </span>
                  <SeverityBadge
                    priority={request.severity}
                    className="hidden shrink-0 sm:inline-flex"
                  />
                  <Badge
                    variant="outline"
                    className={`shrink-0 ${statusClassName(request.linearStateType)}`}
                  >
                    {request.linearStateName}
                  </Badge>
                  <RiArrowRightSLine
                    className="size-4 shrink-0 text-muted-foreground/50 motion-safe:transition-transform motion-safe:group-hover:translate-x-0.5"
                    aria-hidden
                  />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </PageShell>
  )
}

function RequestListSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading requests"
      className="overflow-hidden rounded-2xl bg-card ring-1 ring-foreground/10"
    >
      <div className="divide-y">
        {[0, 1, 2].map((row) => (
          <div key={row} className="flex items-center gap-4 px-5 py-4">
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-2/5" />
              <Skeleton className="h-3 w-1/4" />
            </div>
            <Skeleton className="h-5 w-24 rounded-4xl" />
          </div>
        ))}
      </div>
    </div>
  )
}
