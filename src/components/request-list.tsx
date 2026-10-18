import { Link } from "@tanstack/react-router"
import { RiArrowRightSLine } from "@remixicon/react"
import { SeverityBadge } from "@/components/severity-badge"
import {
  REQUEST_STAGES,
  requestStage,
  needsAttention,
} from "@/components/request-pipeline"
import { formatDateTime } from "@/lib/helpdesk-api"
import type { PortalRequestSummary } from "@/lib/helpdesk-api"

export function RequestList({
  requests,
  onPrefetch,
}: {
  requests: PortalRequestSummary[]
  onPrefetch: (id: string) => void
}) {
  return (
    <>
      {[
        REQUEST_STAGES[1],
        REQUEST_STAGES[0],
        REQUEST_STAGES[4],
        REQUEST_STAGES[2],
        REQUEST_STAGES[3],
      ].map((stage) => {
        const group = requests.filter(
          (request) => requestStage(request.linearStateType) === stage.key
        )
        if (group.length === 0) return null
        return (
          <section
            key={stage.key}
            aria-label={stage.label}
            className="border-t first:border-t-0"
          >
            <h2 className="flex items-center gap-2.5 px-5 pt-5 pb-2 text-xs font-medium">
              <span
                className={`size-1.5 rounded-full ${stage.bar}`}
                aria-hidden
              />
              {stage.label}
              <span className="font-mono text-muted-foreground">
                {group.length}
              </span>
              <span className="ml-1 hidden font-normal text-muted-foreground sm:inline">
                {stage.key === "started"
                  ? "Being worked on by the team"
                  : stage.key === "triage"
                    ? "Waiting for review"
                    : stage.key === "resolved"
                      ? "Work completed or closed"
                      : "Ready for the next step"}
              </span>
            </h2>
            <ul className="pb-2">
              {group.map((request) => (
                <li key={request.id}>
                  <Link
                    to="/requests/$requestId"
                    params={{ requestId: request.id }}
                    onMouseEnter={() => onPrefetch(request.id)}
                    onFocus={() => onPrefetch(request.id)}
                    className={`group grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 px-5 py-3 outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset sm:grid-cols-[5.25rem_4.5rem_minmax(0,1fr)_3rem_1rem] ${needsAttention(request) ? "bg-status-triage/5" : ""}`}
                  >
                    <span className="hidden sm:inline-flex">
                      {request.severity == null ? (
                        <span className="text-xs text-muted-foreground">
                          No severity
                        </span>
                      ) : (
                        <SeverityBadge priority={request.severity} />
                      )}
                    </span>
                    <span className="hidden font-mono text-[11px] text-muted-foreground sm:block">
                      {request.linearIdentifier}
                    </span>
                    <span className="min-w-0 text-[13px] font-medium wrap-anywhere sm:truncate">
                      {request.title}
                    </span>
                    <time
                      dateTime={request.updatedAt}
                      title={`Updated ${formatDateTime(request.updatedAt)}`}
                      className="text-right font-mono text-[11px] text-muted-foreground"
                    >
                      {Math.max(
                        0,
                        Math.floor(
                          (Date.now() - Date.parse(request.updatedAt)) /
                            86_400_000
                        )
                      )}
                      d
                    </time>
                    <RiArrowRightSLine
                      className="hidden size-4 text-muted-foreground/60 sm:block"
                      aria-hidden
                    />
                    <span className="col-span-2 text-[11px] text-muted-foreground sm:hidden">
                      {request.linearIdentifier} · {request.linearStateName}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )
      })}
    </>
  )
}
