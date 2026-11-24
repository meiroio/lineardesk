import { Toggle, ToggleGroup } from "@ui-sdk/react/toggle"

import { SEVERITY_LEVELS } from "@/components/severity-badge"
import { cn } from "@/lib/utils"

export function SeverityFilter({
  selected,
  onChange,
}: {
  selected: ReadonlySet<number>
  onChange: (priorities: Set<number>) => void
}) {
  return (
    <ToggleGroup
      multiple
      aria-label="Severity"
      value={[...selected].map(String)}
      onValueChange={(value) => onChange(new Set(value.map(Number)))}
      className="flex flex-wrap items-center gap-2 ps-0"
    >
      {SEVERITY_LEVELS.map((level) => (
        <Toggle
          key={level.priority}
          value={String(level.priority)}
          className="group ms-0 h-auto gap-1.5 rounded-lg border-border bg-transparent px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground data-pressed:border-status-triage/40 data-pressed:bg-status-triage/10 data-pressed:text-status-triage"
        >
          <span
            className={cn(
              "size-1.5 rounded-full group-data-pressed:bg-current",
              level.dot
            )}
            aria-hidden
          />
          {level.label}
        </Toggle>
      ))}
    </ToggleGroup>
  )
}
