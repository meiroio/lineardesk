export type PortalRequest = {
  id: string
  requesterEmail: string
  title: string
  description: string
  linearIssueId: string
  linearIdentifier: string
  linearUrl: string
  linearStateId: string
  linearStateName: string
  linearStateType: string
  severity: number | null
  linearDetailsCommentId: string | null
  linearDetailsCommentedAt: string | null
  createdAt: string
  updatedAt: string
  lastLinearSyncedAt: string
  comments?: PortalRequestComment[]
}

export type PortalRequestComment = {
  id: string
  body: string
  authorName: string
  createdAt: string
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
    this.name = "ApiError"
  }
}

export async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(path, {
    credentials: "include",
  })

  return readJson<T>(response)
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    credentials: "include",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  })

  return readJson<T>(response)
}

export async function uploadImage(
  file: File
): Promise<{ assetUrl: string; filename: string }> {
  const response = await fetch("/api/uploads", {
    method: "POST",
    credentials: "include",
    headers: {
      "content-type": file.type,
      "x-filename": encodeURIComponent(file.name),
    },
    body: file,
  })

  return readJson<{ assetUrl: string; filename: string }>(response)
}

export type RequestResolution = "resolved" | "canceled"

export async function closeRequest(
  id: string,
  resolution: RequestResolution
): Promise<{ request: PortalRequest }> {
  return apiPost<{ request: PortalRequest }>(`/api/requests/${id}/close`, {
    resolution,
  })
}

export const requestKeys = {
  list: ["requests"] as const,
  detail: (id: string) => ["request", id] as const,
}

export async function fetchRequests(): Promise<PortalRequest[]> {
  const data = await apiGet<{ requests: PortalRequest[] }>("/api/requests")
  return data.requests
}

export async function fetchRequest(id: string): Promise<PortalRequest> {
  const data = await apiGet<{ request: PortalRequest }>(`/api/requests/${id}`)
  return data.request
}

async function readJson<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    const message =
      data &&
      typeof data === "object" &&
      "error" in data &&
      typeof data.error === "string"
        ? data.error
        : `Request failed with status ${response.status}`

    throw new ApiError(response.status, message)
  }

  return data as T
}

export function formatDateTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value))
}

export function formatCommentCount(count: number) {
  return count === 1 ? "1 comment" : `${count} comments`
}

export function statusClassName(type: string) {
  switch (type) {
    case "completed":
      return "border-transparent bg-status-completed/10 text-status-completed dark:bg-status-completed/20"
    case "started":
      return "border-transparent bg-status-started/10 text-status-started dark:bg-status-started/20"
    case "canceled":
    case "duplicate":
      return "border-transparent bg-muted text-muted-foreground"
    case "triage":
      return "border-transparent bg-status-triage/10 text-status-triage dark:bg-status-triage/20"
    default:
      return ""
  }
}

// Linear's terminal state types — Done (completed), Cancelled and Duplicate
// (both canceled). Kept as the single source of truth for "is this request
// finished", used by the list status filter and the detail close affordance.
export const TERMINAL_STATUS_TYPES = ["completed", "canceled"] as const

export function isDoneStatus(type: string): boolean {
  return (TERMINAL_STATUS_TYPES as readonly string[]).includes(type)
}

// Poll interval for the live-status views (list + detail) so webhook-driven
// status changes surface without a manual reload.
export const LIVE_REFETCH_INTERVAL_MS = 15_000
