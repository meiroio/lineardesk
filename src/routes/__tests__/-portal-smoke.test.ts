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
import { requestKeys } from "@/lib/helpdesk-api"
import type { PortalRequest, RequestListQuery } from "@/lib/helpdesk-api"
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
  let context: AppRouterContext
  let requests: PortalRequest[]
  let apiPost: ReturnType<typeof vi.fn>
  let fetchRequest: ReturnType<typeof vi.fn>
  let fetchRequests: ReturnType<typeof vi.fn>
  let requirePortalAuth: ReturnType<typeof vi.fn>
  let updateRequest: ReturnType<typeof vi.fn>
  let updateRequestSeverity: ReturnType<typeof vi.fn>
  let uploadImage: ReturnType<typeof vi.fn>

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
    fetchRequests = vi.fn(async (query: RequestListQuery) => ({
      requests: requests
        .slice(query.page * query.pageSize, (query.page + 1) * query.pageSize)
        .map(
          ({
            id,
            title,
            linearIdentifier,
            linearStateName,
            linearStateType,
            severity,
            updatedAt,
            createdAt,
          }) => ({
            id,
            title,
            linearIdentifier,
            linearStateName,
            linearStateType,
            severity,
            updatedAt,
            createdAt,
          })
        ),
      total: requests.length,
      page: query.page,
      pageSize: query.pageSize,
    }))
    fetchRequest = vi.fn(async (id: string) => {
      const request = requests.find((item) => item.id === id)
      if (!request) throw new Error("not_found")
      return { ...request, comments: [] }
    })
    apiPost = vi.fn(async (path: string, body: unknown) => {
      if (path.endsWith("/comments")) {
        return {
          comment: {
            id: "comment-1",
            body: (body as { body: string }).body,
            authorName: "LinearDesk",
            createdAt: NOW,
          },
        }
      }
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
        attachments: string
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
          ...(input.attachments ? ["", "Attachments", input.attachments] : []),
        ].join("\n"),
        linearIdentifier: "PRD-102",
        linearTeamId: input.teamId,
        severity: input.severity === "urgent" ? 1 : 2,
      })
      requests = [request, ...requests]

      return { request }
    })
    updateRequest = vi.fn(
      async (
        id: string,
        input: { title: string; description: string; severity: string }
      ) => {
        const request = requests.find((item) => item.id === id)
        if (!request) throw new Error("not_found")

        const updated = {
          ...request,
          title: input.title,
          description: input.description,
        }
        requests = requests.map((item) => (item.id === id ? updated : item))
        return { request: updated }
      }
    )
    updateRequestSeverity = vi.fn(async (id: string, severity: number) => {
      const request = requests.find((item) => item.id === id)
      if (!request) throw new Error("not_found")

      const updated = { ...request, severity }
      requests = requests.map((item) => (item.id === id ? updated : item))
      return { request: updated }
    })
    uploadImage = vi.fn(async (file: File) => ({
      assetUrl: `https://uploads.linear.app/${file.name}`,
      filename: file.name,
    }))

    context = {
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
        updateRequest:
          updateRequest as AppRouterContext["api"]["updateRequest"],
        updateRequestSeverity:
          updateRequestSeverity as AppRouterContext["api"]["updateRequestSeverity"],
        uploadImage: uploadImage as AppRouterContext["api"]["uploadImage"],
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
    }
  })

  afterEach(() => {
    cleanup()
    context.queryClient.clear()
    vi.clearAllMocks()
  })

  it("loads the dashboard, submits a request, and lands on the detail page", async () => {
    renderPortal("/", context)

    expect(
      await screen.findByRole("heading", { name: "Requests" })
    ).toBeTruthy()
    expect(await screen.findByText("Existing CSV export failure")).toBeTruthy()
    expect(fetchRequests).toHaveBeenCalledWith({
      page: 0,
      pageSize: 10,
      status: "active",
      severity: [],
    })

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
    fireEvent.drop(screen.getByText("Drop screenshots here or"), {
      dataTransfer: {
        files: [
          new File(["screenshot"], "export-error.png", { type: "image/png" }),
        ],
      },
    })
    await waitFor(() => {
      expect(uploadImage).toHaveBeenCalledWith(
        expect.objectContaining({ name: "export-error.png" })
      )
      expect(screen.getByRole("img", { name: "export-error.png" })).toBeTruthy()
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
        attachments:
          "![export-error.png](https://uploads.linear.app/export-error.png)",
      })
    })
    expect(
      await screen.findByRole("heading", {
        name: "Smoke flow CSV export failure",
      })
    ).toBeTruthy()
    expect(screen.getAllByText("PRD-102")).toHaveLength(2)
    await waitFor(() => expect(fetchRequest).toHaveBeenCalledWith("request-2"))
    expect(await screen.findByText("No Linear comments yet.")).toBeTruthy()
    expect(screen.getByText(/The CSV export downloads/)).toBeTruthy()
    expect(
      screen.getByRole("img", { name: "export-error.png" }).getAttribute("src")
    ).toBe(
      "/api/requests/request-2/assets?url=https%3A%2F%2Fuploads.linear.app%2Fexport-error.png"
    )

    fireEvent.change(screen.getByLabelText("Reply"), {
      target: { value: "More evidence" },
    })
    fireEvent.drop(screen.getByText("Drop screenshots here or"), {
      dataTransfer: {
        files: [new File(["screenshot"], "reply.png", { type: "image/png" })],
      },
    })
    await waitFor(() => {
      expect(
        screen.getByLabelText<HTMLTextAreaElement>("Reply").value
      ).toContain("![reply.png](https://uploads.linear.app/reply.png)")
    })
    fireEvent.click(screen.getByRole("button", { name: "Post reply" }))
    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith(
        "/api/requests/request-2/comments",
        expect.objectContaining({
          body: expect.stringContaining(
            "![reply.png](https://uploads.linear.app/reply.png)"
          ),
        })
      )
    })

    fireEvent.click(screen.getByRole("button", { name: "Edit" }))
    fireEvent.drop(screen.getAllByText("Drop screenshots here or")[0], {
      dataTransfer: {
        files: [
          new File(["screenshot"], "updated-view.png", { type: "image/png" }),
        ],
      },
    })
    await waitFor(() => {
      expect(screen.getByRole("img", { name: "updated-view.png" })).toBeTruthy()
    })
    fireEvent.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() => {
      expect(updateRequest).toHaveBeenCalledWith(
        "request-2",
        expect.objectContaining({
          description: expect.stringContaining(
            "![updated-view.png](https://uploads.linear.app/updated-view.png)"
          ),
        })
      )
    })
    expect(screen.getByRole("img", { name: "updated-view.png" })).toBeTruthy()

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

  it("requests server pages and resets the page when either filter changes", async () => {
    requests = Array.from({ length: 11 }, (_, index) =>
      makeRequest({
        id: `request-${index + 1}`,
        title: `Request ${index + 1}`,
        linearIdentifier: `BAS-${index + 1}`,
      })
    )
    renderPortal("/", context)

    expect(await screen.findByText("Showing 1–10 of 11")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Next" }))
    expect(await screen.findByText("Showing 11–11 of 11")).toBeTruthy()
    expect(screen.getByText("Request 11")).toBeTruthy()
    expect(screen.queryByText("Request 1")).toBeNull()
    expect(fetchRequests).toHaveBeenLastCalledWith({
      page: 1,
      pageSize: 10,
      status: "active",
      severity: [],
    })

    requests = requests.map((request) => ({
      ...request,
      linearStateName: "Done",
      linearStateType: "completed",
    }))
    fireEvent.click(screen.getByRole("radio", { name: "Done" }))
    await waitFor(() =>
      expect(fetchRequests).toHaveBeenLastCalledWith({
        page: 0,
        pageSize: 10,
        status: "done",
        severity: [],
      })
    )
    expect(await screen.findByText("Showing 1–10 of 11")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Next" }))
    expect(await screen.findByText("Showing 11–11 of 11")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "High" }))
    await waitFor(() =>
      expect(fetchRequests).toHaveBeenLastCalledWith({
        page: 0,
        pageSize: 10,
        status: "done",
        severity: [2],
      })
    )
    expect(await screen.findByText("Showing 1–10 of 11")).toBeTruthy()

    const listQueries = context.queryClient.getQueryCache().findAll({
      queryKey: requestKeys.list,
    })
    expect(listQueries).toHaveLength(5)
    await context.queryClient.invalidateQueries({
      queryKey: requestKeys.list,
      refetchType: "none",
    })
    expect(listQueries.every((query) => query.state.isInvalidated)).toBe(true)

    fireEvent.click(screen.getByRole("button", { name: "Next" }))
    expect(await screen.findByText("Showing 11–11 of 11")).toBeTruthy()
    requests = requests.slice(0, 10)
    await context.queryClient.invalidateQueries({ queryKey: requestKeys.list })
    await waitFor(() =>
      expect(fetchRequests).toHaveBeenLastCalledWith({
        page: 0,
        pageSize: 10,
        status: "done",
        severity: [2],
      })
    )
    expect(await screen.findByText("Request 1")).toBeTruthy()
    expect(screen.queryByText("Request 11")).toBeNull()
  })

  it("reuses a completed hover prefetch through focus and detail navigation", async () => {
    renderPortal("/", context)
    const link = await screen.findByRole("link", {
      name: /Existing CSV export failure/,
    })
    fireEvent.mouseEnter(link)
    await waitFor(() =>
      expect(
        context.queryClient.getQueryData<PortalRequest>(
          requestKeys.detail("request-1")
        )?.comments
      ).toEqual([])
    )
    fireEvent.focus(link)
    fireEvent.click(link)
    expect(
      await screen.findByRole("heading", {
        name: "Existing CSV export failure",
      })
    ).toBeTruthy()
    expect(fetchRequest).toHaveBeenCalledTimes(1)
  })

  it("loads detail content rather than treating list summaries as full records", async () => {
    renderPortal("/", context)
    const link = await screen.findByRole("link", {
      name: /Existing CSV export failure/,
    })
    let finish!: (request: PortalRequest) => void
    fetchRequest.mockReturnValueOnce(
      new Promise<PortalRequest>((resolve) => {
        finish = resolve
      })
    )
    fireEvent.click(link)
    expect(
      await screen.findByRole("status", { name: "Loading request" })
    ).toBeTruthy()
    finish({ ...requests[0], comments: [] })
    expect(await screen.findByText(/The CSV export downloads/)).toBeTruthy()
  })

  it("loads comment attachments lazily with their owning comment ID", async () => {
    fetchRequest.mockResolvedValueOnce({
      ...requests[0],
      comments: [
        {
          id: "comment-1",
          body: "![comment screenshot](https://uploads.linear.app/comment.png)",
          authorName: "Ada",
          createdAt: NOW,
        },
      ],
    })
    renderPortal("/requests/request-1", context)
    const screenshot = await screen.findByRole("img", {
      name: "comment screenshot",
    })
    expect(screenshot.getAttribute("loading")).toBe("lazy")
    expect(screenshot.getAttribute("src")).toBe(
      "/api/requests/request-1/assets?url=https%3A%2F%2Fuploads.linear.app%2Fcomment.png&commentId=comment-1"
    )
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
