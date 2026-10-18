import { cn } from "@/lib/utils"

export type StatusScope = "active" | "done" | "all"

const STATUS_OPTIONS: { value: StatusScope; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "done", label: "Done" },
  { value: "all", label: "All" },
]

export function StatusFilter({
  value,
  onChange,
}: {
  value: StatusScope
  onChange: (value: StatusScope) => void
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Status"
      className="inline-flex items-center gap-0.5 rounded-[10px] border bg-popover p-0.5"
    >
      {STATUS_OPTIONS.map((option) => {
        const active = value === option.value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "inline-flex items-center rounded-[7px] border px-3 py-1.5 text-[13px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              active
                ? "border-border bg-muted text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
