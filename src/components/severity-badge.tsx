import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

export const SEVERITY_LEVELS = [
  { priority: 1, label: "Urgent", dot: "bg-destructive" },
  { priority: 2, label: "High", dot: "bg-status-triage" },
  { priority: 3, label: "Medium", dot: "bg-foreground/40" },
  { priority: 4, label: "Low", dot: "bg-muted-foreground/40" },
] as const

const SEVERITY: Record<number, (typeof SEVERITY_LEVELS)[number]> =
  Object.fromEntries(SEVERITY_LEVELS.map((level) => [level.priority, level]))

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
    <Badge variant="outline" className={className}>
      <span className={cn("size-1.5 rounded-full", meta.dot)} aria-hidden />
      {meta.label}
    </Badge>
  )
}
