import { Link, createFileRoute, useNavigate } from "@tanstack/react-router"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  RiAddLine,
  RiArrowRightSLine,
  RiErrorWarningLine,
  RiInboxArchiveLine,
  RiLogoutBoxRLine,
} from "@remixicon/react"
import { useEffect, useState } from "react"

import { BrandMark } from "@/components/logo"
import { PageShell } from "@/components/page-shell"
import { SeverityBadge } from "@/components/severity-badge"
import { SeverityFilter } from "@/components/severity-filter"
import { StatusFilter } from "@/components/status-filter"
import type { StatusScope } from "@/components/status-filter"
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
import {
  ApiError,
  formatDateTime,
  isDoneStatus,
  LIVE_REFETCH_INTERVAL_MS,
  requestKeys,
  statusClassName,
} from "@/lib/helpdesk-api"

export const Route = createFileRoute("/")({
  beforeLoad: ({ context }) => context.requirePortalAuth(),
  component: Dashboard,
})

const PAGE_SIZE = 10

function Dashboard() {
  const { api, auth } = Route.useRouteContext()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [page, setPage] = useState(0)
  const [severityFilter, setSeverityFilter] = useState<Set<number>>(new Set())
  const [statusScope, setStatusScope] = useState<StatusScope>("active")

  const {
    data: requests = [],
    status: queryStatus,
    error,
  } = useQuery({
    queryKey: requestKeys.list,
    queryFn: api.fetchRequests,
    // Poll so webhook-driven status changes appear without a manual reload,
    // and refresh when the tab regains focus (the global default is off).
    refetchInterval: LIVE_REFETCH_INTERVAL_MS,
    refetchOnWindowFocus: true,
  })

  const isAuthError = error instanceof ApiError && error.status === 401

  useEffect(() => {
    if (isAuthError) void navigate({ to: "/login" })
  }, [isAuthError, navigate])

  const status =
    queryStatus === "pending" || isAuthError
      ? "loading"
      : queryStatus === "error"
        ? "error"
        : "ready"

  const prefetchRequest = (id: string) => {
    void queryClient.prefetchQuery({
      queryKey: requestKeys.detail(id),
      queryFn: () => api.fetchRequest(id),
    })
  }

  const toggleSeverity = (priority: number) => {
    setSeverityFilter((prev) => {
      const next = new Set(prev)
      if (next.has(priority)) next.delete(priority)
      else next.add(priority)
      return next
    })
    setPage(0)
  }

  const changeStatusScope = (scope: StatusScope) => {
    setStatusScope(scope)
    setPage(0)
  }

  // Filter the full set first, then paginate, so each page holds up to
  // PAGE_SIZE matching requests (not a page sliced and then filtered down).
  const filteredRequests = requests.filter((request) => {
    const done = isDoneStatus(request.linearStateType)
    if (statusScope === "active" && done) return false
    if (statusScope === "done" && !done) return false
    if (severityFilter.size > 0) {
      return request.severity != null && severityFilter.has(request.severity)
    }
    return true
  })

  const pageCount = Math.max(1, Math.ceil(filteredRequests.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount - 1)
  const visibleRequests = filteredRequests.slice(
    currentPage * PAGE_SIZE,
    currentPage * PAGE_SIZE + PAGE_SIZE
  )
  const rangeStart = currentPage * PAGE_SIZE + 1
  const rangeEnd = currentPage * PAGE_SIZE + visibleRequests.length

  return (
    <PageShell
      eyebrow={<BrandMark />}
      title="Requests"
      description="Track the current Linear status for your organization's requests."
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
              void Promise.resolve(auth.signOut()).finally(() =>
                navigate({ to: "/login" })
              )
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
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3">
            <StatusFilter value={statusScope} onChange={changeStatusScope} />
            <SeverityFilter
              selected={severityFilter}
              onToggle={toggleSeverity}
            />
          </div>
          {filteredRequests.length === 0 ? (
            <Empty className="rounded-2xl border border-dashed">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <RiInboxArchiveLine aria-hidden />
                </EmptyMedia>
                <EmptyTitle>No matching requests</EmptyTitle>
                <EmptyDescription>
                  No requests match the current filters.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <>
              <div className="overflow-hidden rounded-2xl bg-card ring-1 ring-foreground/10">
                <ul className="divide-y">
                  {visibleRequests.map((request) => (
                    <li key={request.id}>
                      <Link
                        to="/requests/$requestId"
                        params={{ requestId: request.id }}
                        onMouseEnter={() => prefetchRequest(request.id)}
                        onFocus={() => prefetchRequest(request.id)}
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
              {filteredRequests.length > PAGE_SIZE ? (
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
                  <span>
                    Showing {rangeStart}–{rangeEnd} of {filteredRequests.length}
                  </span>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={currentPage === 0}
                      onClick={() => setPage(currentPage - 1)}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={currentPage >= pageCount - 1}
                      onClick={() => setPage(currentPage + 1)}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              ) : null}
            </>
          )}
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
