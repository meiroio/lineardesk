import type { HelpdeskRepository, LinearGateway } from "./types"

export type ReconcileResult = {
  checked: number
  updated: number
}

export type ReconcileOpenRequestsInput = {
  repo: HelpdeskRepository
  linear: LinearGateway
  limit: number
}

// Safety net for missed Linear webhooks: pull the current state of every
// non-terminal request and correct any that drifted. Only requests whose
// stored state no longer matches Linear change `updatedAt`. Every checked row
// advances its synchronization time so later batches also reach older tickets.
export async function reconcileOpenRequests({
  repo,
  linear,
  limit,
}: ReconcileOpenRequestsInput): Promise<ReconcileResult> {
  const checkedAt = new Date()
  const requests = await repo.listOpenRequests(limit)
  if (requests.length === 0) return { checked: 0, updated: 0 }

  const states = await linear.listIssueStates(
    requests.map((request) => request.linearIssueId)
  )
  const stateByIssueId = new Map(states.map((state) => [state.id, state]))

  let updated = 0
  for (const request of requests) {
    const current = stateByIssueId.get(request.linearIssueId)
    if (!current || current.state.id === request.linearStateId) continue

    await repo.updateRequestFromLinear({
      linearIssueId: current.id,
      linearIdentifier: current.identifier,
      linearUrl: current.url,
      linearStateId: current.state.id,
      linearStateName: current.state.name,
      linearStateType: current.state.type,
    })
    updated += 1
  }

  await repo.markRequestsSynced(
    requests.map((request) => request.linearIssueId),
    checkedAt
  )

  return { checked: requests.length, updated }
}
