import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select"
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
    <Badge variant="outline" className={className}>
      <span className={cn("size-1.5 rounded-full", meta.dot)} aria-hidden />
      {meta.label}
    </Badge>
  )
}

export function SeveritySelect({
  priority,
  onValueChange,
  disabled,
  invalid,
  describedBy,
}: {
  priority: number | null
  onValueChange: (priority: number) => void
  disabled?: boolean
  invalid?: boolean
  describedBy?: string
}) {
  const meta = severityLevelOf(priority)

  return (
    <Select
      value={meta.priority}
      onValueChange={(value) => {
        if (value != null) onValueChange(value)
      }}
      disabled={disabled}
    >
      <SelectTrigger
        aria-label={`Severity: ${meta.label}`}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        aria-busy={disabled || undefined}
        className="h-5! gap-1 border-border px-2 py-0.5 text-xs font-medium shadow-none"
      >
        <span className={cn("size-1.5 rounded-full", meta.dot)} aria-hidden />
        {meta.label}
      </SelectTrigger>
      <SelectContent align="end" alignItemWithTrigger={false}>
        {SEVERITY_LEVELS.map((level) => (
          <SelectItem key={level.priority} value={level.priority}>
            <span
              className={cn("size-1.5 rounded-full", level.dot)}
              aria-hidden
            />
            {level.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
