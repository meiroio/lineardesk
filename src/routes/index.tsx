import { Link, createFileRoute, useNavigate } from "@tanstack/react-router"
import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import {
  RiAddLine,
  RiArrowRightSLine,
  RiErrorWarningLine,
  RiInboxArchiveLine,
  RiLogoutBoxRLine,
  RiSearchLine,
  RiRefreshLine,
  RiTimeLine,
} from "@remixicon/react"
import { useEffect, useState } from "react"

import { RequestPipeline, needsAttention } from "@/components/request-pipeline"
import { TeamFilter } from "@/components/team-filter"
import { PageShell } from "@/components/page-shell"
import { RequestList } from "@/components/request-list"
import { SeverityFilter } from "@/components/severity-filter"
import { StatusFilter } from "@/components/status-filter"
import type { StatusScope } from "@/components/status-filter"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Input } from "@/components/ui/input"
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
  LIVE_REFETCH_INTERVAL_MS,
  requestKeys,
} from "@/lib/helpdesk-api"
import type { RequestListQuery } from "@/lib/helpdesk-api"

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
  const [search, setSearch] = useState("")
  const [teamId, setTeamId] = useState("")
  const [severityFilter, setSeverityFilter] = useState<Set<number>>(new Set())
  const [statusScope, setStatusScope] = useState<StatusScope>("active")
  const listQuery: RequestListQuery = {
    page,
    pageSize: PAGE_SIZE,
    status: statusScope,
    severity: [...severityFilter].sort((left, right) => left - right),
    ...(teamId ? { teamId } : {}),
  }

  const {
    data: requestPage,
    status: queryStatus,
    error,
    isPlaceholderData,
    dataUpdatedAt,
  } = useQuery({
    queryKey: requestKeys.page(listQuery),
    queryFn: () => api.fetchRequests(listQuery),
    placeholderData: keepPreviousData,
    // Poll so webhook-driven status changes appear without a manual reload,
    // and refresh when the tab regains focus (the global default is off).
    refetchInterval: LIVE_REFETCH_INTERVAL_MS,
    refetchOnWindowFocus: true,
  })
  const requests = requestPage?.requests ?? []
  const visibleRequests = requests.filter((request) =>
    `${request.title} ${request.linearIdentifier}`
      .toLowerCase()
      .includes(search.trim().toLowerCase())
  )
  const reviewCount = requests.filter(needsAttention).length
  const total = requestPage?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const currentPage = requestPage?.page ?? page

  useEffect(() => {
    if (requestPage && !isPlaceholderData && page >= pageCount) {
      setPage(pageCount - 1)
    }
  }, [requestPage, isPlaceholderData, page, pageCount])

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
      staleTime: LIVE_REFETCH_INTERVAL_MS,
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

  const rangeStart = currentPage * PAGE_SIZE + 1
  const rangeEnd = currentPage * PAGE_SIZE + requests.length

  return (
    <PageShell
      title={`${total} ${total === 1 ? "request" : "requests"}${{ active: " in flight", done: " closed", all: "" }[statusScope]}`}
      description={
        reviewCount > 0
          ? `${reviewCount} high-severity ${reviewCount === 1 ? "request is" : "requests are"} awaiting review${total > PAGE_SIZE ? " on this page" : ""}.`
          : "Your requests, from first report to resolution."
      }
      topBarContent={
        <label className="relative block w-32 sm:w-56">
          <RiSearchLine
            className="pointer-events-none absolute top-2.5 left-3 size-3.5 text-muted-foreground"
            aria-hidden
          />
          <Input
            aria-label="Search requests on this page"
            placeholder="Search this page…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="h-9 rounded-[10px] border-border bg-popover pl-9 text-xs"
          />
        </label>
      }
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
      ) : total === 0 &&
        statusScope === "all" &&
        severityFilter.size === 0 &&
        !teamId ? (
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
        <div className="flex flex-col gap-4" aria-busy={isPlaceholderData}>
          <div className="-mt-2 mb-4">
            <RequestPipeline
              requests={requests}
              paginated={total > PAGE_SIZE}
            />
          </div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <TeamFilter
                api={api}
                value={teamId}
                onChange={(next) => {
                  setTeamId(next)
                  setPage(0)
                }}
              />
              <span
                className="hidden h-5 w-px bg-border sm:block"
                aria-hidden
              />
              <StatusFilter value={statusScope} onChange={changeStatusScope} />
              <span
                className="hidden h-5 w-px bg-border sm:block"
                aria-hidden
              />
              <SeverityFilter
                selected={severityFilter}
                onToggle={toggleSeverity}
              />
            </div>
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <RiTimeLine className="size-3.5" aria-hidden />
              Last updated
            </span>
          </div>
          {visibleRequests.length === 0 ? (
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
                <RequestList
                  requests={visibleRequests}
                  onPrefetch={prefetchRequest}
                />
              </div>
              {total > PAGE_SIZE ? (
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
                  <span>
                    Showing {rangeStart}–{rangeEnd} of {total}
                  </span>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isPlaceholderData || currentPage === 0}
                      onClick={() => setPage(currentPage - 1)}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={
                        isPlaceholderData || currentPage >= pageCount - 1
                      }
                      onClick={() => setPage(currentPage + 1)}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              ) : null}
            </>
          )}
          <footer className="mt-1 flex flex-wrap items-center justify-between gap-3 px-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-2">
              <RiRefreshLine className="size-3.5" aria-hidden />
              Refreshed
              {dataUpdatedAt
                ? ` · ${new Date(dataUpdatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                : ""}
            </span>
            {statusScope === "active" ? (
              <button
                type="button"
                className="flex items-center gap-1.5 text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => changeStatusScope("done")}
              >
                Show closed requests{" "}
                <RiArrowRightSLine className="size-3.5" aria-hidden />
              </button>
            ) : null}
          </footer>
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
