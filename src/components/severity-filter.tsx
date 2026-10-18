import { SEVERITY_LEVELS } from "@/components/severity-badge"
import { cn } from "@/lib/utils"

export function SeverityFilter({
  selected,
  onToggle,
}: {
  selected: ReadonlySet<number>
  onToggle: (priority: number) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="sr-only">Severity</span>
      {SEVERITY_LEVELS.map((level) => {
        const active = selected.has(level.priority)
        return (
          <button
            key={level.priority}
            type="button"
            aria-pressed={active}
            onClick={() => onToggle(level.priority)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              active
                ? "border-status-triage/40 bg-status-triage/10 text-status-triage"
                : "border-border text-muted-foreground hover:text-foreground"
            )}
          >
            <span
              className={cn(
                "size-1.5 rounded-full",
                active ? "bg-current" : level.dot
              )}
              aria-hidden
            />
            {level.label}
          </button>
        )
      })}
    </div>
  )
}
