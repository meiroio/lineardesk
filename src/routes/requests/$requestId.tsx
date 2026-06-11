import { Link, createFileRoute, useNavigate } from "@tanstack/react-router"
import { RiAddLine, RiExternalLinkLine } from "@remixicon/react"
import type { FormEvent } from "react"
import { useCallback, useEffect, useState } from "react"

import { DescriptionBody } from "@/components/description-body"
import { PageShell } from "@/components/page-shell"
import { SeverityBadge } from "@/components/severity-badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import type { PortalRequest, RequestResolution } from "@/lib/helpdesk-api"
import {
  ApiError,
  apiGet,
  apiPost,
  closeRequest,
  formatCommentCount,
  formatDateTime,
  statusClassName,
} from "@/lib/helpdesk-api"
import { requirePortalAuth } from "@/lib/route-guards"

export const Route = createFileRoute("/requests/$requestId")({
  beforeLoad: requirePortalAuth,
  component: RequestDetail,
})

function RequestDetail() {
  const navigate = useNavigate()
  const { requestId } = Route.useParams()
  const [request, setRequest] = useState<PortalRequest | null>(null)
  const [status, setStatus] = useState<
    "loading" | "ready" | "not-found" | "error"
  >("loading")
  const [replyBody, setReplyBody] = useState("")
  const [replyError, setReplyError] = useState<string | null>(null)
  const [replying, setReplying] = useState(false)
  const [closing, setClosing] = useState(false)
  const [closeBusy, setCloseBusy] = useState(false)
  const [closeError, setCloseError] = useState<string | null>(null)
  const comments = request?.comments ?? []
  const fetchRequest = useCallback(() => {
    return apiGet<{ request: PortalRequest }>(`/api/requests/${requestId}`)
  }, [requestId])

  useEffect(() => {
    let active = true

    setStatus("loading")
    setReplyError(null)

    void fetchRequest()
      .then((data) => {
        if (!active) return
        setRequest(data.request)
        setStatus("ready")
      })
      .catch((error) => {
        if (!active) return
        if (error instanceof ApiError && error.status === 401)
          void navigate({ to: "/login" })
        else if (error instanceof ApiError && error.status === 404)
          setStatus("not-found")
        else setStatus("error")
      })
    return () => {
      active = false
    }
  }, [fetchRequest, navigate])

  async function handleReplySubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const body = replyBody.trim()
    if (!body) {
      setReplyError("Reply must not be empty.")
      return
    }

    setReplying(true)
    setReplyError(null)

    try {
      await apiPost(`/api/requests/${requestId}/comments`, { body })
      setReplyBody("")

      const data = await fetchRequest()
      setRequest(data.request)
      setStatus("ready")
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        void navigate({ to: "/login" })
        return
      }

      setReplyError("Reply could not be posted. Try again after a moment.")
    } finally {
      setReplying(false)
    }
  }

  async function handleClose(resolution: RequestResolution) {
    setCloseBusy(true)
    setCloseError(null)

    try {
      const data = await closeRequest(requestId, resolution)
      setRequest(data.request)
      setClosing(false)
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        void navigate({ to: "/login" })
        return
      }

      setCloseError("Could not close the request. Try again after a moment.")
    } finally {
      setCloseBusy(false)
    }
  }

  if (status === "loading") {
    return (
      <PageShell backLabel="Requests" title="Loading request…">
        <RequestDetailSkeleton />
      </PageShell>
    )
  }

  if (status === "not-found") {
    return (
      <PageShell
        backLabel="Requests"
        title="Request not found"
        description="It may have been removed, or the link is incorrect."
      />
    )
  }

  if (status === "error" || !request) {
    return (
      <PageShell
        backLabel="Requests"
        title="Request unavailable"
        description="Try again after a moment."
      />
    )
  }

  const isOpen = !["completed", "canceled"].includes(request.linearStateType)

  return (
    <PageShell
      backLabel="Requests"
      title={request.title}
      description={request.linearIdentifier}
      backActions={
        <Link
          to="/requests/new"
          className={buttonVariants({ variant: "outline" })}
        >
          <RiAddLine aria-hidden />
          New request
        </Link>
      }
      actions={
        <>
          <SeverityBadge priority={request.severity} />
          <Badge
            variant="outline"
            className={statusClassName(request.linearStateType)}
          >
            {request.linearStateName}
          </Badge>
        </>
      }
    >
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Description</CardTitle>
            </CardHeader>
            <CardContent>
              <DescriptionBody text={request.description} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Activity</CardTitle>
              <CardDescription>
                {formatCommentCount(comments.length)}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {comments.length > 0 ? (
                <ol className="flex flex-col gap-5">
                  {comments.map((comment) => (
                    <li key={comment.id} className="flex gap-3">
                      <Avatar>
                        <AvatarFallback>
                          {initialsOf(comment.authorName)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
                          <p className="text-sm font-medium">
                            {comment.authorName}
                          </p>
                          <time
                            className="text-xs text-muted-foreground"
                            dateTime={comment.createdAt}
                          >
                            {formatDateTime(comment.createdAt)}
                          </time>
                        </div>
                        <p className="text-sm leading-6 whitespace-pre-wrap text-muted-foreground">
                          {comment.body}
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No Linear comments yet.
                </p>
              )}
            </CardContent>
            <CardFooter className="flex-col items-stretch border-t">
              <form
                className="flex flex-col gap-3"
                onSubmit={handleReplySubmit}
              >
                <Label htmlFor="request-reply" className="sr-only">
                  Reply
                </Label>
                <Textarea
                  id="request-reply"
                  name="body"
                  value={replyBody}
                  onChange={(event) => setReplyBody(event.target.value)}
                  minLength={1}
                  maxLength={5000}
                  required
                  rows={4}
                  aria-invalid={replyError ? true : undefined}
                  aria-describedby={
                    replyError ? "request-reply-error" : undefined
                  }
                  placeholder="Add a reply..."
                />
                {replyError ? (
                  <p
                    id="request-reply-error"
                    className="text-sm text-destructive"
                  >
                    {replyError}
                  </p>
                ) : null}
                <div className="flex justify-end">
                  <Button type="submit" disabled={replying}>
                    {replying ? "Posting..." : "Post reply"}
                  </Button>
                </div>
              </form>
            </CardFooter>
          </Card>
        </div>

        <Card size="sm" className="lg:sticky lg:top-8">
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="flex flex-col gap-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">Linear issue</dt>
                <dd>
                  <a
                    href={request.linearUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 font-medium hover:underline"
                  >
                    {request.linearIdentifier}
                    <RiExternalLinkLine
                      className="size-3.5 text-muted-foreground"
                      aria-hidden
                    />
                  </a>
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">Submitted</dt>
                <dd className="text-right font-medium">
                  {formatDateTime(request.createdAt)}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">Last synced</dt>
                <dd className="text-right font-medium">
                  {formatDateTime(request.lastLinearSyncedAt)}
                </dd>
              </div>
            </dl>
          </CardContent>
          {isOpen ? (
            <CardFooter className="flex-col items-stretch gap-2 border-t">
              {closing ? (
                <>
                  <p className="text-sm text-muted-foreground">
                    Close this request as:
                  </p>
                  <Button
                    variant="outline"
                    disabled={closeBusy}
                    onClick={() => void handleClose("resolved")}
                  >
                    Resolved
                  </Button>
                  <Button
                    variant="outline"
                    disabled={closeBusy}
                    onClick={() => void handleClose("canceled")}
                  >
                    Cancelled
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={closeBusy}
                    onClick={() => {
                      setClosing(false)
                      setCloseError(null)
                    }}
                  >
                    Keep open
                  </Button>
                </>
              ) : (
                <Button variant="outline" onClick={() => setClosing(true)}>
                  Close request
                </Button>
              )}
              {closeError ? (
                <p className="text-sm text-destructive">{closeError}</p>
              ) : null}
            </CardFooter>
          ) : null}
        </Card>
      </div>
    </PageShell>
  )
}

function initialsOf(name: string) {
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("")

  return initials || "?"
}

function RequestDetailSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading request"
      className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]"
    >
      <div className="flex flex-col gap-6">
        <div className="rounded-2xl bg-card p-6 ring-1 ring-foreground/10">
          <Skeleton className="h-4 w-24" />
          <div className="mt-5 space-y-2.5">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-4/5" />
            <Skeleton className="h-3 w-3/5" />
          </div>
        </div>
        <div className="rounded-2xl bg-card p-6 ring-1 ring-foreground/10">
          <Skeleton className="h-4 w-16" />
          <div className="mt-5 flex gap-3">
            <Skeleton className="size-8 rounded-full" />
            <div className="min-w-0 flex-1 space-y-2.5">
              <Skeleton className="h-3 w-32" />
              <Skeleton className="h-3 w-full" />
            </div>
          </div>
        </div>
      </div>
      <div className="rounded-2xl bg-card p-4 ring-1 ring-foreground/10">
        <Skeleton className="h-4 w-16" />
        <div className="mt-4 space-y-3">
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-full" />
        </div>
      </div>
    </div>
  )
}
