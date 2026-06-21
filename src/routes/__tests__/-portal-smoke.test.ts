// @vitest-environment jsdom

import { RouterProvider, createMemoryHistory } from "@tanstack/react-router"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { createElement } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { PortalRequest } from "@/lib/helpdesk-api"
import { getRouter } from "@/router"

const mockRouteGuards = vi.hoisted(() => ({
  requirePortalAuth: vi.fn(),
}))

const mockAuthClient = vi.hoisted(() => ({
  signOut: vi.fn(async () => undefined),
}))

const mockHelpdeskApi = vi.hoisted(() => {
  class ApiError extends Error {
    constructor(
      readonly status: number,
      message: string
    ) {
      super(message)
      this.name = "ApiError"
    }
  }

  return {
    ApiError,
    apiPost: vi.fn(),
    closeRequest: vi.fn(),
    fetchRequest: vi.fn(),
    fetchRequests: vi.fn(),
    formatCommentCount: vi.fn((count: number) =>
      count === 1 ? "1 comment" : `${count} comments`
    ),
    formatDateTime: vi.fn((value: string) => value),
    isDoneStatus: vi.fn((type: string) =>
      ["completed", "canceled", "duplicate"].includes(type)
    ),
    requestKeys: {
      list: ["requests"] as const,
      detail: (id: string) => ["request", id] as const,
    },
    statusClassName: vi.fn(() => ""),
    updateRequest: vi.fn(),
    uploadImage: vi.fn(),
    LIVE_REFETCH_INTERVAL_MS: 60_000,
  }
})

vi.mock("@/lib/route-guards", () => mockRouteGuards)

vi.mock("@/lib/auth-client", () => ({
  authClient: mockAuthClient,
}))

vi.mock("@/lib/helpdesk-api", () => mockHelpdeskApi)

const NOW = "2026-01-01T00:00:00.000Z"

describe("portal route smoke", () => {
  let requests: PortalRequest[]

  beforeEach(() => {
    Object.defineProperty(window, "scrollTo", {
      configurable: true,
      value: vi.fn(),
    })

    requests = [
      makeRequest({
        id: "request-1",
        title: "Existing CSV export failure",
        linearIdentifier: "BAS-101",
      }),
    ]

    mockRouteGuards.requirePortalAuth.mockResolvedValue(undefined)
    mockHelpdeskApi.fetchRequests.mockImplementation(async () => requests)
    mockHelpdeskApi.fetchRequest.mockImplementation(async (id: string) => {
      const request = requests.find((item) => item.id === id)
      if (!request) throw new mockHelpdeskApi.ApiError(404, "not_found")
      return { ...request, comments: [] }
    })
    mockHelpdeskApi.apiPost.mockImplementation(
      async (path: string, body: unknown) => {
        if (path !== "/api/requests") {
          throw new Error(`Unexpected API path ${path}`)
        }

        const input = body as {
          title: string
          severity: string
          expectedBehaviour: string
          currentBehaviour: string
          stepsToReproduce: string
        }
        const request = makeRequest({
          id: "request-2",
          title: input.title,
          description: [
            "Expected behaviour",
            input.expectedBehaviour,
            "",
            "Current behaviour",
            input.currentBehaviour,
            "",
            "Steps to reproduce",
            input.stepsToReproduce,
          ].join("\n"),
          linearIdentifier: "BAS-102",
          severity: input.severity === "urgent" ? 1 : 2,
        })
        requests = [request, ...requests]

        return { request }
      }
    )
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it("loads the dashboard, submits a request, and lands on the detail page", async () => {
    renderPortal("/")

    expect(
      await screen.findByRole("heading", { name: "Requests" })
    ).toBeTruthy()
    expect(await screen.findByText("Existing CSV export failure")).toBeTruthy()

    fireEvent.click(screen.getByRole("link", { name: /new request/i }))
    expect(
      await screen.findByRole("heading", { name: "New request" })
    ).toBeTruthy()

    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Smoke flow CSV export failure" },
    })
    fireEvent.click(screen.getByLabelText("High"))
    fireEvent.change(screen.getByLabelText("Expected behaviour"), {
      target: { value: "The CSV export downloads." },
    })
    fireEvent.change(screen.getByLabelText("Current behaviour"), {
      target: { value: "The export returns a 500." },
    })
    fireEvent.change(screen.getByLabelText("Steps to reproduce"), {
      target: { value: "Open Reports and click Export CSV." },
    })
    fireEvent.click(screen.getByRole("button", { name: "Submit request" }))

    await waitFor(() => {
      expect(mockHelpdeskApi.apiPost).toHaveBeenCalledWith("/api/requests", {
        title: "Smoke flow CSV export failure",
        severity: "high",
        expectedBehaviour: "The CSV export downloads.",
        currentBehaviour: "The export returns a 500.",
        stepsToReproduce: "Open Reports and click Export CSV.",
      })
    })
    expect(
      await screen.findByRole("heading", {
        name: "Smoke flow CSV export failure",
      })
    ).toBeTruthy()
    expect(screen.getAllByText("BAS-102")).toHaveLength(2)
    expect(screen.getByText(/The CSV export downloads/)).toBeTruthy()
  })
})

function renderPortal(path: string) {
  const router = getRouter()
  router.update({
    history: createMemoryHistory({
      initialEntries: [path],
    }),
  })

  render(createElement(RouterProvider, { router }))
  return router
}

function makeRequest(
  input: Partial<PortalRequest> &
    Pick<PortalRequest, "id" | "title" | "linearIdentifier">
): PortalRequest {
  return {
    requesterUserId: "user-ada",
    organizationId: "org-acme",
    requesterEmail: "ada@example.com",
    description: "Expected behaviour\nThe CSV export downloads.",
    linearIssueId: input.linearIssueId ?? `linear-${input.id}`,
    linearUrl: `https://linear.app/base/issue/${input.linearIdentifier}`,
    linearTeamId: "team-id",
    linearStateId: "state-triage",
    linearStateName: "Triage",
    linearStateType: "triage",
    source: "web",
    severity: 2,
    linearDetailsCommentId: null,
    linearDetailsCommentedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    lastLinearSyncedAt: NOW,
    slackChannelId: null,
    slackMessageTs: null,
    ...input,
  }
}
