import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

const SEVERITY: Record<number, { label: string; dot: string }> = {
  1: { label: "Urgent", dot: "bg-destructive" },
  2: { label: "High", dot: "bg-status-triage" },
  3: { label: "Medium", dot: "bg-foreground/40" },
  4: { label: "Low", dot: "bg-muted-foreground/40" },
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
    <Badge variant="outline" className={className}>
      <span className={cn("size-1.5 rounded-full", meta.dot)} aria-hidden />
      {meta.label}
    </Badge>
  )
}
