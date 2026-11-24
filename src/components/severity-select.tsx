import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemIcon,
  SelectItemIndicator,
  SelectTrigger,
  SelectValue,
  SelectValueIcon,
} from "@ui-sdk/react/select"

import { SEVERITY_LEVELS, severityLevelOf } from "@/components/severity-badge"
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
  return (
    <Select
      value={String(severityLevelOf(priority).priority)}
      onValueChange={(value) => {
        if (value != null) onValueChange(Number(value))
      }}
      disabled={disabled}
    >
      <SelectTrigger
        aria-label="Severity"
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        aria-busy={disabled || undefined}
        className="h-6 gap-1.5 rounded-full px-2 text-xs"
      >
        <SelectValueIcon />
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end" className="min-w-36">
        {SEVERITY_LEVELS.map((level) => (
          <SelectItem
            key={level.priority}
            value={String(level.priority)}
            label={level.label}
          >
            <SelectItemIcon>
              <span className={cn("size-1.5 rounded-full", level.dot)} />
            </SelectItemIcon>
            {level.label}
            <SelectItemIndicator />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
