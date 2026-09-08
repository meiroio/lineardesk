import { SEVERITY_LEVELS, severityLevelOf } from "@/components/severity-badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"

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
