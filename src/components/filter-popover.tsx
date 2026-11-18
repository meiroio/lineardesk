import { useState } from "react"
import { Popover } from "@base-ui/react/popover"
import type { RemixiconComponentType } from "@remixicon/react"
import {
  RiArrowDownSLine,
  RiCheckLine,
  RiSearchLine,
  RiStackLine,
} from "@remixicon/react"

import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export type FilterOption = { id: string; name: string; key?: string }

/**
 * Searchable single-select filter. The empty id is reserved for the "All …"
 * option, which is always listed first.
 */
export function FilterPopover({
  noun,
  pluralNoun,
  icon: Icon,
  options,
  value,
  onChange,
  status = "ready",
  onRetry,
}: {
  noun: string
  pluralNoun: string
  icon: RemixiconComponentType
  options: FilterOption[]
  value: string
  onChange: (id: string) => void
  status?: "pending" | "error" | "ready"
  onRetry?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const allOptions: FilterOption[] = [
    { id: "", name: `All ${pluralNoun}` },
    ...options,
  ]
  const selected = allOptions.find((option) => option.id === value)
  const visible = allOptions.filter((option) =>
    `${option.name} ${option.key ?? ""}`
      .toLowerCase()
      .includes(search.toLowerCase().trim())
  )
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setSearch("")
      }}
    >
      <Popover.Trigger
        aria-label={`Filter by ${noun}`}
        className="flex h-9 max-w-56 items-center gap-2 rounded-[10px] border bg-popover px-3 text-[13px] font-medium"
      >
        <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="truncate">{selected?.name ?? `Selected ${noun}`}</span>
        <RiArrowDownSLine
          className="size-3.5 shrink-0 text-muted-foreground"
          aria-hidden
        />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={8} align="start" className="z-50">
          <Popover.Popup className="w-[260px] max-w-[calc(100vw-2rem)] rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-xl">
            <Popover.Title className="sr-only">
              Filter {pluralNoun}
            </Popover.Title>
            <div className="relative border-b pb-2">
              <RiSearchLine
                className="pointer-events-none absolute top-2.5 left-2.5 size-3.5 text-muted-foreground"
                aria-hidden
              />
              <Input
                autoFocus
                aria-label={`Filter ${pluralNoun}`}
                placeholder={`Filter ${pluralNoun}…`}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="h-9 rounded-md border-0 bg-transparent pl-8 text-[13px]"
              />
            </div>
            {status === "pending" ? (
              <p role="status" className="p-3 text-xs text-muted-foreground">
                Loading {pluralNoun}…
              </p>
            ) : status === "error" ? (
              <div className="p-3 text-xs">
                <p role="alert">Could not load {pluralNoun}.</p>
                {onRetry ? (
                  <Button variant="ghost" size="sm" onClick={onRetry}>
                    Retry
                  </Button>
                ) : null}
              </div>
            ) : (
              <div className="max-h-64 overflow-y-auto pt-1">
                {visible.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    aria-label={option.name}
                    aria-pressed={value === option.id}
                    onClick={() => {
                      onChange(option.id)
                      setOpen(false)
                      setSearch("")
                    }}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] hover:bg-muted",
                      value === option.id && "bg-muted"
                    )}
                  >
                    {option.id ? (
                      <Icon
                        className="size-3.5 shrink-0 text-muted-foreground"
                        aria-hidden
                      />
                    ) : (
                      <RiStackLine
                        className="size-3.5 shrink-0 text-muted-foreground"
                        aria-hidden
                      />
                    )}
                    <span className="min-w-0 flex-1 truncate">
                      {option.name}
                    </span>
                    {option.key ? (
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {option.key}
                      </span>
                    ) : null}
                    <span className="size-3.5">
                      {value === option.id ? (
                        <RiCheckLine
                          className="size-3.5 text-primary"
                          aria-hidden
                        />
                      ) : null}
                    </span>
                  </button>
                ))}
                {visible.length === 0 ? (
                  <p className="p-3 text-xs text-muted-foreground">
                    No {pluralNoun} found.
                  </p>
                ) : null}
              </div>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
