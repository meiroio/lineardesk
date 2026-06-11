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
      <span className="text-sm font-medium text-muted-foreground">
        Severity
      </span>
      {SEVERITY_LEVELS.map((level) => {
        const active = selected.has(level.priority)
        return (
          <button
            key={level.priority}
            type="button"
            aria-pressed={active}
            onClick={() => onToggle(level.priority)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-4xl border px-3 py-1 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              active
                ? "border-transparent bg-primary text-primary-foreground"
                : "border-border text-muted-foreground hover:text-foreground"
            )}
          >
            <span
              className={cn(
                "size-1.5 rounded-full",
                active ? "bg-primary-foreground" : level.dot
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
