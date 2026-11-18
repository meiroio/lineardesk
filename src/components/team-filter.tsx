import { useQuery } from "@tanstack/react-query"
import { RiTeamLine } from "@remixicon/react"

import { FilterPopover } from "@/components/filter-popover"
import { teamKeys } from "@/lib/helpdesk-api"
import type { HelpdeskApiClient } from "@/lib/app-context"

export function TeamFilter({
  api,
  value,
  onChange,
}: {
  api: HelpdeskApiClient
  value: string
  onChange: (teamId: string) => void
}) {
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: teamKeys.list,
    queryFn: () => api.fetchTeams(),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  })
  return (
    <FilterPopover
      noun="team"
      pluralNoun="teams"
      icon={RiTeamLine}
      options={data?.teams ?? []}
      value={value}
      onChange={onChange}
      status={isPending ? "pending" : isError ? "error" : "ready"}
      onRetry={() => void refetch()}
    />
  )
}
