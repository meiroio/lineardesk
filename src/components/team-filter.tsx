import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Popover } from "@base-ui/react/popover"
import {
  RiArrowDownSLine,
  RiCheckLine,
  RiTeamLine,
  RiSearchLine,
  RiStackLine,
} from "@remixicon/react"

import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { teamKeys } from "@/lib/helpdesk-api"
import type { HelpdeskApiClient } from "@/lib/app-context"
import { cn } from "@/lib/utils"

export function TeamFilter({
  api,
  value,
  onChange,
}: {
  api: HelpdeskApiClient
  value: string
  onChange: (teamId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: teamKeys.list,
    queryFn: () => api.fetchTeams(),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  })
  const options = [
    { id: "", name: "All teams", key: "" },
    ...(data?.teams ?? []),
  ]
  const selected = options.find((team) => team.id === value)
  const visible = options.filter((team) =>
    `${team.name} ${team.key}`
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
        aria-label="Filter by team"
        className="flex h-9 items-center gap-2 rounded-[10px] border bg-popover px-3 text-[13px] font-medium"
      >
        <RiTeamLine className="size-3.5 text-muted-foreground" aria-hidden />
        {selected?.name ?? "Selected team"}
        <RiArrowDownSLine
          className="size-3.5 text-muted-foreground"
          aria-hidden
        />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={8} align="start" className="z-50">
          <Popover.Popup className="w-[260px] max-w-[calc(100vw-2rem)] rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-xl">
            <Popover.Title className="sr-only">Filter teams</Popover.Title>
            <div className="relative border-b pb-2">
              <RiSearchLine
                className="pointer-events-none absolute top-2.5 left-2.5 size-3.5 text-muted-foreground"
                aria-hidden
              />
              <Input
                autoFocus
                aria-label="Filter teams"
                placeholder="Filter teams…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="h-9 rounded-md border-0 bg-transparent pl-8 text-[13px]"
              />
            </div>
            {isPending ? (
              <p role="status" className="p-3 text-xs text-muted-foreground">
                Loading teams…
              </p>
            ) : isError ? (
              <div className="p-3 text-xs">
                <p role="alert">Could not load teams.</p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void refetch()}
                >
                  Retry
                </Button>
              </div>
            ) : (
              <div className="max-h-64 overflow-y-auto pt-1">
                {visible.map((team) => (
                  <button
                    key={team.id}
                    type="button"
                    aria-label={team.name}
                    aria-pressed={value === team.id}
                    onClick={() => {
                      onChange(team.id)
                      setOpen(false)
                      setSearch("")
                    }}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] hover:bg-muted",
                      value === team.id && "bg-muted"
                    )}
                  >
                    {team.id ? (
                      <RiTeamLine
                        className="size-3.5 shrink-0 text-muted-foreground"
                        aria-hidden
                      />
                    ) : (
                      <RiStackLine
                        className="size-3.5 shrink-0 text-muted-foreground"
                        aria-hidden
                      />
                    )}
                    <span className="min-w-0 flex-1 truncate">{team.name}</span>
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {team.key}
                    </span>
                    <span className="size-3.5">
                      {value === team.id ? (
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
                    No teams found.
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
