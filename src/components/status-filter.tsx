import {
  SegmentedControl,
  SegmentedControlIndicator,
  SegmentedControlItem,
} from "@ui-sdk/react/segmented-control"

export type StatusScope = "active" | "done" | "all"

const STATUS_OPTIONS: { value: StatusScope; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "done", label: "Done" },
  { value: "all", label: "All" },
]

function isStatusScope(value: string | null): value is StatusScope {
  return STATUS_OPTIONS.some((option) => option.value === value)
}

export function StatusFilter({
  value,
  onChange,
}: {
  value: StatusScope
  onChange: (value: StatusScope) => void
}) {
  return (
    <SegmentedControl
      aria-label="Status"
      value={value}
      onValueChange={(next) => {
        if (isStatusScope(next)) onChange(next)
      }}
      className="rounded-[10px] bg-popover"
    >
      <SegmentedControlIndicator className="rounded-[7px] border-border bg-muted" />
      {STATUS_OPTIONS.map((option) => (
        <SegmentedControlItem
          key={option.value}
          value={option.value}
          className="rounded-[7px] text-[13px]"
        >
          {option.label}
        </SegmentedControlItem>
      ))}
    </SegmentedControl>
  )
}
