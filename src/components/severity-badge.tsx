import { RiBarChartFill } from "@remixicon/react"
import { cn } from "@/lib/utils"

export const SEVERITY_LEVELS = [
  { priority: 1, label: "Urgent", dot: "bg-destructive" },
  { priority: 2, label: "High", dot: "bg-status-triage" },
  { priority: 3, label: "Medium", dot: "bg-foreground/40" },
  { priority: 4, label: "Low", dot: "bg-muted-foreground/40" },
] as const

const SEVERITY: Record<number, (typeof SEVERITY_LEVELS)[number]> =
  Object.fromEntries(SEVERITY_LEVELS.map((level) => [level.priority, level]))

export function severityLevelOf(priority: number | null) {
  return SEVERITY[priority ?? 3] ?? SEVERITY[3]
}

export function SeverityBadge({
  priority,
  className,
}: {
  priority: number | null
  className?: string
}) {
  if (priority == null) return null
  const meta = SEVERITY[priority]
  // Record<number, …> types the lookup as always-present, but an out-of-range
  // priority is null at runtime; keep the guard.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (!meta) return null

  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 text-xs",
        priority === 1
          ? "text-destructive"
          : priority === 2
            ? "text-status-triage"
            : "text-muted-foreground",
        className
      )}
    >
      <RiBarChartFill className="size-3.5" aria-hidden />
      {meta.label}
    </span>
  )
}
