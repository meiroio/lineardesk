import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { RiUserLine, RiTeamLine, RiFolderLine } from "@remixicon/react"
import { Button } from "@ui-sdk/react/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectTrigger,
} from "@ui-sdk/react/select"

import { assignmentKeys } from "@/lib/helpdesk-api"
import type { PortalRequest } from "@/lib/helpdesk-api"
import type { HelpdeskApiClient } from "@/lib/app-context"

export function RequestAssignment({
  request,
  api,
  canWrite,
}: {
  request: PortalRequest
  api: HelpdeskApiClient
  canWrite: boolean
}) {
  const queryClient = useQueryClient()
  const queryKey = assignmentKeys.detail(request.id)
  const assignment = useQuery({
    queryKey,
    queryFn: () => api.fetchRequestAssignment(request.id),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  })
  const mutation = useMutation({
    mutationFn: (assigneeId: string | null) =>
      api.updateRequestAssignee(request.id, assigneeId),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey })
    },
    onSuccess: (data) => {
      queryClient.setQueryData(queryKey, data)
    },
  })
  const data = assignment.data
  return (
    <section aria-label="Request assignment" className="flex flex-col gap-5">
      <h2 className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
        Who’s on it
      </h2>
      {assignment.isPending ? (
        <p role="status" className="text-xs text-muted-foreground">
          Loading assignment…
        </p>
      ) : !data ? (
        <div className="space-y-2">
          <p role="alert" className="text-xs text-muted-foreground">
            Could not load assignment.
          </p>
          <Button data-size="sm" onClick={() => assignment.refetch()}>
            Retry assignment
          </Button>
        </div>
      ) : (
        <>
          <div className="flex min-w-0 items-center gap-3">
            <span
              aria-hidden
              className="flex size-12 shrink-0 items-center justify-center rounded-full bg-violet-600 font-heading text-sm font-semibold text-white"
            >
              {data.assignee ? (
                data.assignee.name
                  .split(/\s+/)
                  .slice(0, 2)
                  .map((part) => part[0])
                  .join("")
              ) : (
                <RiUserLine className="size-5" />
              )}
            </span>
            <div className="min-w-0">
              <p
                className="truncate text-base font-semibold"
                title={data.assignee?.name}
              >
                {data.assignee?.name ?? "Unassigned"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {data.team.name}
              </p>
            </div>
          </div>
          <dl className="space-y-3 text-xs">
            <div className="flex items-center justify-between gap-3">
              <dt className="flex items-center gap-2 text-muted-foreground">
                <RiTeamLine className="size-3.5" aria-hidden />
                Team
              </dt>
              <dd className="text-right">{data.team.name}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="flex items-center gap-2 text-muted-foreground">
                <RiFolderLine className="size-3.5" aria-hidden />
                Project
              </dt>
              <dd className="text-right">
                {data.project?.name ?? "No project"}
              </dd>
            </div>
          </dl>
        </>
      )}
      {canWrite && data ? (
        <div className="border-t pt-4">
          <Select
            value={data.assignee?.id ?? "unassigned"}
            disabled={mutation.isPending}
            onValueChange={(value) => {
              if (value !== null) {
                mutation.reset()
                mutation.mutate(value === "unassigned" ? null : value)
              }
            }}
          >
            <SelectTrigger
              aria-label="Assign request"
              className="h-9 w-full justify-between rounded-lg text-xs"
              aria-describedby={
                mutation.isError ? "assignment-error" : undefined
              }
            >
              {mutation.isPending ? "Saving assignment…" : "Change assignee"}
            </SelectTrigger>
            <SelectContent align="end" className="min-w-56">
              <SelectItem value="unassigned">
                Unassigned
                <SelectItemIndicator />
              </SelectItem>
              {data.assignee &&
              !data.assignees.some((user) => user.id === data.assignee?.id) ? (
                <SelectItem value={data.assignee.id} disabled>
                  {data.assignee.name}
                  <SelectItemIndicator />
                </SelectItem>
              ) : null}
              {data.assignees.map((user) => (
                <SelectItem key={user.id} value={user.id}>
                  {user.name}
                  <SelectItemIndicator />
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {mutation.isError ? (
            <p
              id="assignment-error"
              role="alert"
              className="mt-2 text-xs text-destructive"
            >
              Could not update assignment. Try again.
            </p>
          ) : null}
        </div>
      ) : null}
      {data && assignment.isError ? (
        <p role="status" className="text-xs text-muted-foreground">
          Assignment may be out of date.{" "}
          <Button data-variant="link" onClick={() => assignment.refetch()}>
            Refresh assignment
          </Button>
        </p>
      ) : null}
    </section>
  )
}
