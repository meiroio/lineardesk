import type { PortalRequestSummary } from "@/lib/helpdesk-api"

export const REQUEST_STAGES = [
  {
    key: "triage",
    label: "Triage",
    color: "text-status-triage",
    bar: "bg-status-triage",
  },
  {
    key: "started",
    label: "In progress",
    color: "text-status-started",
    bar: "bg-status-started",
  },
  {
    key: "resolved",
    label: "Resolved",
    color: "text-status-completed",
    bar: "bg-status-completed",
  },
  {
    key: "closed",
    label: "Closed",
    color: "text-muted-foreground",
    bar: "bg-muted-foreground",
  },
  {
    key: "queued",
    label: "Queued",
    color: "text-muted-foreground",
    bar: "bg-muted-foreground",
  },
] as const

export function requestStage(type: string) {
  if (type === "completed") return "resolved"
  if (type === "canceled" || type === "duplicate") return "closed"
  if (type === "started" || type === "triage") return type
  return "queued"
}

export function needsAttention(request: PortalRequestSummary) {
  return (
    request.linearStateType === "triage" &&
    [1, 2].includes(request.severity ?? 0)
  )
}

export function RequestPipeline({
  requests,
  paginated,
}: {
  requests: PortalRequestSummary[]
  paginated: boolean
}) {
  const stages = REQUEST_STAGES.map((stage) => ({
    ...stage,
    count: requests.filter(
      (request) => requestStage(request.linearStateType) === stage.key
    ).length,
  }))
  const visible = stages.filter(
    (stage) => !["queued", "closed"].includes(stage.key) || stage.count > 0
  )
  const largestCount = Math.max(...visible.map((stage) => stage.count))
  return (
    <section aria-label="Request pipeline" className="flex flex-col gap-3">
      {paginated ? (
        <p className="text-xs text-muted-foreground">Pipeline on this page</p>
      ) : null}
      <div className="flex gap-1">
        {visible.map((stage) => (
          <div
            key={stage.key}
            className={`flex min-w-0 flex-1 flex-col gap-3 ${stage.count === largestCount ? "sm:flex-[3]" : ""}`}
          >
            <div className={`h-1 rounded-sm ${stage.bar}`} />
            <div className="px-0.5">
              <p className={`text-xs font-medium ${stage.color}`}>
                {stage.label}
              </p>
              <p className="mt-1 flex flex-wrap items-baseline gap-x-2">
                <span className="font-heading text-[32px] leading-none font-medium tracking-tight">
                  {stage.count}
                </span>
                <span className="hidden text-xs text-muted-foreground sm:inline">
                  {stage.key === "triage"
                    ? "awaiting review"
                    : stage.key === "started"
                      ? "being worked on"
                      : stage.key === "resolved"
                        ? "completed"
                        : stage.key === "closed"
                          ? "canceled or duplicate"
                          : "awaiting a start"}
                </span>
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
