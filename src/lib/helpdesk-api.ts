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
