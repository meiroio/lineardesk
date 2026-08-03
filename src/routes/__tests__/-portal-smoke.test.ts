// @vitest-environment jsdom

import { RouterProvider, createMemoryHistory } from "@tanstack/react-router"
import { QueryClient } from "@tanstack/react-query"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { createElement } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { AppRouterContext } from "@/lib/app-context"
import type { PortalRequest } from "@/lib/helpdesk-api"
import { getRouter } from "@/router"

vi.mock("../__root", async () => {
  const { Outlet, createRootRouteWithContext } =
    await import("@tanstack/react-router")

  return {
    Route: createRootRouteWithContext<AppRouterContext>()({
      component: Outlet,
    }),
  }
})

const NOW = "2026-01-01T00:00:00.000Z"

describe("portal route smoke", () => {
  let requests: PortalRequest[]
  let apiPost: ReturnType<typeof vi.fn>
  let fetchRequest: ReturnType<typeof vi.fn>
  let fetchRequests: ReturnType<typeof vi.fn>
  let requirePortalAuth: ReturnType<typeof vi.fn>
  let updateRequestSeverity: ReturnType<typeof vi.fn>

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

    requirePortalAuth = vi.fn(async () => undefined)
    fetchRequests = vi.fn(async () => requests)
    fetchRequest = vi.fn(async (id: string) => {
      const request = requests.find((item) => item.id === id)
      if (!request) throw new Error("not_found")
      return { ...request, comments: [] }
    })
    apiPost = vi.fn(async (path: string, body: unknown) => {
      if (path !== "/api/requests") {
        throw new Error(`Unexpected API path ${path}`)
      }

      const input = body as {
        title: string
        severity: string
        teamId: string
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
        linearIdentifier: "PRD-102",
        linearTeamId: input.teamId,
        severity: input.severity === "urgent" ? 1 : 2,
      })
      requests = [request, ...requests]

      return { request }
    })
    updateRequestSeverity = vi.fn(async (id: string, severity: number) => {
      const request = requests.find((item) => item.id === id)
      if (!request) throw new Error("not_found")

      const updated = { ...request, severity }
      requests = requests.map((item) => (item.id === id ? updated : item))
      return { request: updated }
    })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it("loads the dashboard, submits a request, and lands on the detail page", async () => {
    renderPortal("/", {
      queryClient: new QueryClient({
        defaultOptions: {
          queries: { refetchOnWindowFocus: false, retry: false },
        },
      }),
      api: {
        apiPost: apiPost as AppRouterContext["api"]["apiPost"],
        closeRequest: vi.fn(),
        fetchRequest: fetchRequest as AppRouterContext["api"]["fetchRequest"],
        fetchRequests:
          fetchRequests as AppRouterContext["api"]["fetchRequests"],
        fetchTeams: vi.fn(async () => ({
          teams: [
            { id: "team-id", key: "BAS", name: "Base" },
            { id: "team-product", key: "PRD", name: "Product" },
          ],
          defaultTeamId: "team-id",
        })),
        updateRequest: vi.fn(),
        updateRequestSeverity:
          updateRequestSeverity as AppRouterContext["api"]["updateRequestSeverity"],
        uploadImage: vi.fn(),
      },
      auth: {
        signOut: vi.fn(async () => undefined),
        signIn: {
          magicLink: vi.fn(async () => undefined),
          social: vi.fn(async () => undefined),
        },
      },
      requirePortalAuth:
        requirePortalAuth as AppRouterContext["requirePortalAuth"],
    })

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
    const team = screen.getByRole("combobox", { name: "Team" })
    expect(team.textContent).toContain("Base (BAS)")
    fireEvent.click(team)
    const product = await screen.findByRole("option", {
      name: "Product (PRD)",
    })
    fireEvent.pointerDown(product, { button: 0, pointerType: "mouse" })
    fireEvent.click(product)
    expect(team.textContent).toContain("Product (PRD)")
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
      expect(apiPost).toHaveBeenCalledWith("/api/requests", {
        title: "Smoke flow CSV export failure",
        severity: "high",
        teamId: "team-product",
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
    expect(screen.getAllByText("PRD-102")).toHaveLength(2)
    expect(screen.getByText(/The CSV export downloads/)).toBeTruthy()
    const severity = screen.getByRole("combobox", {
      name: "Severity: High",
    })
    fireEvent.click(severity)
    const low = await screen.findByRole("option", { name: "Low" })
    fireEvent.pointerDown(low, { button: 0, pointerType: "mouse" })
    fireEvent.click(low)
    await waitFor(() => {
      expect(updateRequestSeverity).toHaveBeenCalledWith("request-2", 4)
    })
    expect(screen.getByRole("combobox", { name: "Severity: Low" })).toBeTruthy()
    expect(requirePortalAuth).toHaveBeenCalled()
  })
})

function renderPortal(path: string, context: AppRouterContext) {
  const router = getRouter(context)
  router.update({
    context,
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
