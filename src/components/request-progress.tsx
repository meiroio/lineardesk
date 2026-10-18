import { RiCheckLine } from "@remixicon/react"
import type { ReactNode } from "react"

import { Badge } from "@/components/ui/badge"
import { isDoneStatus, statusClassName } from "@/lib/helpdesk-api"
import type { PortalRequest } from "@/lib/helpdesk-api"
import { cn } from "@/lib/utils"

export function RequestProgress({
  request,
  assignment,
}: {
  request: PortalRequest
  assignment: ReactNode
}) {
  const done = isDoneStatus(request.linearStateType)
  const step = done
    ? 3
    : request.linearStateType === "started"
      ? 2
      : request.linearStateType === "triage"
        ? 1
        : 0
  const currentTone =
    {
      completed:
        "text-status-completed border-status-completed bg-status-completed/15",
      started: "text-status-started border-status-started bg-status-started/15",
      triage: "text-status-triage border-status-triage bg-status-triage/15",
    }[request.linearStateType] ??
    "text-muted-foreground border-muted-foreground bg-muted"
  const steps = [
    "Submitted",
    "Triage",
    "In progress",
    done ? request.linearStateName : "Resolved",
  ]
  const statements = [
    "Your request is in the queue and ready for the team.",
    "Your request is being reviewed to confirm scope and priority.",
    "The team is working on your request.",
    "This request has been closed.",
  ]
  return (
    <section
      aria-label="Request progress"
      className="grid overflow-hidden rounded-[18px] border border-border/60 bg-card md:grid-cols-[minmax(0,1fr)_20rem]"
    >
      <div className="flex min-w-0 flex-col justify-between gap-8 p-5 sm:p-7">
        <div className="space-y-3">
          <Badge
            className={cn(
              "gap-2 rounded-full px-3 py-1 text-xs",
              statusClassName(request.linearStateType)
            )}
            variant="outline"
          >
            <span className="size-1.5 rounded-full bg-current" aria-hidden />
            {request.linearStateName}
          </Badge>
          <h2 className="font-heading text-xl leading-snug font-medium tracking-[-0.015em]">
            {statements[step]}
          </h2>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Follow the latest status here. Updates and replies stay together in
            Activity.
          </p>
        </div>
        <ol aria-label="Request timeline" className="grid grid-cols-4 gap-2">
          {steps.map((label, index) => (
            <li
              key={index}
              aria-current={index === step ? "step" : undefined}
              className="min-w-0"
            >
              <div className="mb-3 flex items-center gap-2" aria-hidden>
                <span
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-full border",
                    index < step
                      ? "border-primary bg-primary text-primary-foreground"
                      : index === step
                        ? currentTone
                        : "border-muted-foreground/30"
                  )}
                >
                  {index < step ? (
                    <RiCheckLine className="size-3" />
                  ) : index === step ? (
                    <span className="size-1.5 rounded-full bg-current" />
                  ) : null}
                </span>
                {index < 3 ? (
                  <span
                    className={cn(
                      "h-px flex-1",
                      index < step ? "bg-primary" : "bg-border"
                    )}
                  />
                ) : null}
              </div>
              <p
                className={cn(
                  "text-[11px] sm:text-xs",
                  index === step
                    ? `font-semibold ${currentTone.split(" ")[0]}`
                    : index < step
                      ? "text-foreground"
                      : "text-muted-foreground"
                )}
              >
                {label}
              </p>
              {index === 0 ? (
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {new Date(request.createdAt).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      </div>
      <div className="flex min-w-0 flex-col gap-5 border-t border-border/60 bg-popover p-5 sm:p-7 md:border-t-0 md:border-l">
        {assignment}
      </div>
    </section>
  )
}
