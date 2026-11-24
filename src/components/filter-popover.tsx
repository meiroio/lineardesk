import { useState } from "react"
import type { RemixiconComponentType } from "@remixicon/react"
import { RiSearchLine, RiStackLine } from "@remixicon/react"
import { Button } from "@ui-sdk/react/button"
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxItemIcon,
  ComboboxItemIndicator,
  ComboboxList,
  ComboboxTrigger,
  ComboboxValue,
} from "@ui-sdk/react/combobox"

export type FilterOption = { id: string; name: string; key?: string }

const ALL = "all"

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
  const [button, setButton] = useState<HTMLButtonElement | null>(null)
  const [query, setQuery] = useState("")
  const allLabel = `All ${pluralNoun}`
  const allOptions = [{ id: ALL, name: allLabel, key: undefined }, ...options]
  const labelOf = (id: string) =>
    allOptions.find((option) => option.id === id)?.name ?? allLabel

  return (
    <div className="flex items-center gap-2">
      <Combobox
        value={value || ALL}
        onValueChange={(next) => onChange(!next || next === ALL ? "" : next)}
        itemToLabel={labelOf}
        query={query}
        onQueryChange={setQuery}
        onOpenChange={(open) => {
          if (open) setQuery("")
        }}
        onOpenChangeComplete={(open) => {
          if (!open) button?.focus()
        }}
        status={
          status === "pending"
            ? "loading"
            : status === "error"
              ? "error"
              : "idle"
        }
      >
        <ComboboxTrigger
          ref={setButton}
          aria-label={`Filter by ${noun}`}
          className="h-9 max-w-56 min-w-40 justify-start rounded-[10px] bg-popover text-[13px]"
        >
          <span className="flex items-center text-muted-foreground" aria-hidden>
            {value ? (
              <Icon className="size-3.5" />
            ) : (
              <RiStackLine className="size-3.5" />
            )}
          </span>
          <span className="flex-1 truncate text-start">
            <ComboboxValue>{(state) => state.label || allLabel}</ComboboxValue>
          </span>
        </ComboboxTrigger>
        <ComboboxContent
          anchor={button}
          align="start"
          sideOffset={8}
          className="w-[260px] max-w-[calc(100vw-2rem)] p-1.5"
        >
          <div className="flex items-center gap-2 border-b px-2 pb-1.5">
            <RiSearchLine
              className="size-3.5 shrink-0 text-muted-foreground"
              aria-hidden
            />
            <ComboboxInput
              autoFocus
              aria-label={`Filter ${pluralNoun}`}
              placeholder={`Filter ${pluralNoun}…`}
              className="h-8 border-0 bg-transparent px-0 text-[13px] focus-visible:outline-none"
            />
          </div>
          <ComboboxEmpty>
            {status === "pending"
              ? `Loading ${pluralNoun}…`
              : status === "error"
                ? `Could not load ${pluralNoun}.`
                : `No ${pluralNoun} found.`}
          </ComboboxEmpty>
          <ComboboxList className="max-h-64 overflow-y-auto pt-1">
            {allOptions.map((option) => (
              <ComboboxItem
                key={option.id}
                value={option.id}
                label={option.name}
                keywords={option.key ? [option.key] : undefined}
                className="text-[13px]"
              >
                <ComboboxItemIcon>
                  {option.id === ALL ? (
                    <RiStackLine className="size-3.5 text-muted-foreground" />
                  ) : (
                    <Icon className="size-3.5 text-muted-foreground" />
                  )}
                </ComboboxItemIcon>
                <span className="min-w-0 flex-1 truncate">{option.name}</span>
                {option.key ? (
                  <span
                    aria-hidden
                    className="font-mono text-[11px] text-muted-foreground"
                  >
                    {option.key}
                  </span>
                ) : null}
                <ComboboxItemIndicator />
              </ComboboxItem>
            ))}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
      {status === "error" && onRetry ? (
        <Button data-variant="ghost" data-size="sm" onClick={onRetry}>
          Retry {pluralNoun}
        </Button>
      ) : null}
    </div>
  )
}
