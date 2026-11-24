// @vitest-environment jsdom

import { RouterProvider, createMemoryHistory } from "@tanstack/react-router"
import { QueryClient } from "@tanstack/react-query"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import { createAgent } from "@ui-sdk/react/agent"
import { createElement } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { AppRouterContext } from "@/lib/app-context"
import { requestKeys } from "@/lib/helpdesk-api"
import type {
  PortalRequest,
  RequestListQuery,
  RequestAssignment,
} from "@/lib/helpdesk-api"
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

let approveAgentSteps = false
const agent = createAgent({
  allow: (step) => !step.confirm || approveAgentSteps,
})

function onPageAgentLabels() {
  const entries = agent
    .snapshot()
    .filter((entry) => !entry.offPage && entry.component !== "more")
  for (const entry of entries) {
    expect(
      entry.label,
      `${entry.component} ${entry.ref} has no name`
    ).toBeTruthy()
  }
  return entries.map((entry) => entry.label)
}

describe("portal route smoke", () => {
  let context: AppRouterContext
  let requests: PortalRequest[]
  let assignment: RequestAssignment
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

    assignment = {
      assignee: { id: "jan", name: "Jan Dvořák", avatarUrl: null },
      project: { id: "integrations", name: "Integrations", color: "#a78bfa" },
      team: { id: "team-id", name: "Support engineering" },
      assignees: [
        { id: "jan", name: "Jan Dvořák", avatarUrl: null },
        { id: "mia", name: "Mia Novak", avatarUrl: null },
      ],
    }
    requirePortalAuth = vi.fn(async () => ({
      portalAccess: {
        authenticated: true,
        isStaff: false,
        organizationId: "org-acme",
      },
    }))
    fetchRequests = vi.fn(async (query: RequestListQuery) => {
      const matching = requests.filter(
        (request) =>
          (!query.teamId || request.linearTeamId === query.teamId) &&
          (!query.organizationId ||
            request.organizationId === query.organizationId)
      )
      return {
        requests: matching
          .slice(query.page * query.pageSize, (query.page + 1) * query.pageSize)
          .map(
            ({
              id,
              title,
              linearIdentifier,
              linearStateName,
              linearStateType,
              severity,
              organizationId,
              updatedAt,
              createdAt,
            }) => ({
              id,
              title,
              linearIdentifier,
              linearStateName,
              linearStateType,
              severity,
              organizationId,
              updatedAt,
              createdAt,
            })
          ),
        total: matching.length,
        page: query.page,
        pageSize: query.pageSize,
      }
    })
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
        fetchRequestAssignment: vi.fn(async () => assignment),
        updateRequestAssignee: vi.fn(async (_id, assigneeId) => {
          assignment = {
            ...assignment,
            assignee:
              assignment.assignees.find((user) => user.id === assigneeId) ??
              null,
          }
          return assignment
        }),
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
    approveAgentSteps = false
    cleanup()
    context.queryClient.clear()
    vi.clearAllMocks()
  })

  function signInAsStaff() {
    requirePortalAuth.mockResolvedValue({
      portalAccess: {
        authenticated: true,
        isStaff: true,
        organizationId: "org-acme",
        organizations: [
          { id: "org-acme", name: "Acme" },
          { id: "org-beta", name: "Beta" },
        ],
      },
    })
  }

  it("shows staff every organization by default and lets them triage any request", async () => {
    requests.push(
      makeRequest({
        id: "request-beta",
        title: "Beta customer request",
        linearIdentifier: "BAS-102",
        organizationId: "org-beta",
      })
    )
    signInAsStaff()
    renderPortal("/", context)

    await screen.findByText("Existing CSV export failure")
    expect(screen.getByText("Beta customer request")).toBeTruthy()
    expect(fetchRequests).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ organizationId: expect.anything() })
    )
    expect(screen.getByText("Beta")).toBeTruthy()
    expect(screen.getByRole("link", { name: "New request" })).toBeTruthy()

    fireEvent.click(
      screen.getByRole("button", { name: "Filter by organization" })
    )
    fireEvent.click(await screen.findByRole("option", { name: "Beta" }))
    await waitFor(() =>
      expect(screen.queryByText("Existing CSV export failure")).toBeNull()
    )
    expect(fetchRequests).toHaveBeenLastCalledWith(
      expect.objectContaining({ organizationId: "org-beta" })
    )

    fireEvent.click(await screen.findByText("Beta customer request"))
    await screen.findByRole("heading", { name: "Beta customer request" })
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Close request" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Post reply" })).toBeNull()
    expect(screen.queryByText("Read-only access")).toBeNull()
    expect(
      await screen.findByRole("combobox", { name: "Assign request" })
    ).toBeTruthy()
    fireEvent.click(screen.getByRole("combobox", { name: "Severity" }))
    const low = await screen.findByRole("option", { name: "Low" })
    fireEvent.pointerDown(low, { button: 0, pointerType: "mouse" })
    fireEvent.click(low)
    await waitFor(() => {
      expect(updateRequestSeverity).toHaveBeenCalledWith("request-beta", 4)
    })
    expect(
      screen.getByRole("link", { name: "Requests" }).getAttribute("href")
    ).toBe("/")
  })

  it("lets an agent find and change every dashboard filter", async () => {
    renderPortal("/", context)
    await screen.findByText("Existing CSV export failure")

    const labels = onPageAgentLabels()
    for (const label of [
      "Search requests on this page",
      "Filter by team",
      "Status",
      "Severity",
      "New request",
      "Sign out",
    ]) {
      expect(labels, `${label} is missing from the snapshot`).toContain(label)
    }

    const result = await agent.act({
      steps: [
        { ref: "Status", action: "setValue", args: ["Done"] },
        { ref: "High", action: "setPressed", args: [true] },
        { ref: "Filter by team", action: "setValue", args: ["Product"] },
      ],
    })
    expect(result.ok, result.error?.message).toBe(true)
    await waitFor(() =>
      expect(fetchRequests).toHaveBeenLastCalledWith({
        page: 0,
        pageSize: 10,
        status: "done",
        severity: [2],
        teamId: "team-product",
      })
    )

    const search = await agent.act({
      steps: [
        {
          ref: "Search requests on this page",
          action: "setValue",
          args: ["no such request"],
        },
      ],
    })
    expect(search.ok, search.error?.message).toBe(true)
    expect(await screen.findByText("No matching requests")).toBeTruthy()
  })

  it("lets an agent fill and submit the new request form", async () => {
    renderPortal("/requests/new", context)
    await screen.findByRole("heading", { name: "New request" })
    await waitFor(() =>
      expect(
        screen.getByRole("combobox", { name: "Team" }).textContent
      ).toContain("Base (BAS)")
    )

    const labels = onPageAgentLabels()
    for (const label of [
      "Title",
      "Team",
      "Severity",
      "Expected behaviour",
      "Current behaviour",
      "Steps to reproduce",
      "Submit request",
    ]) {
      expect(labels, `${label} is missing from the snapshot`).toContain(label)
    }

    const result = await agent.act({
      steps: [
        { ref: "Title", action: "setValue", args: ["Agent filed request"] },
        { ref: "Team", action: "setValue", args: ["Product (PRD)"] },
        { ref: "Severity", action: "setValue", args: ["Urgent"] },
        {
          ref: "Expected behaviour",
          action: "setValue",
          args: ["Exports finish."],
        },
        {
          ref: "Current behaviour",
          action: "setValue",
          args: ["Exports time out."],
        },
        {
          ref: "Steps to reproduce",
          action: "setValue",
          args: ["Export a large report."],
        },
        { ref: "Submit request", action: "press" },
      ],
    })
    expect(result.ok, result.error?.message).toBe(true)
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith("/api/requests", {
        title: "Agent filed request",
        severity: "urgent",
        teamId: "team-product",
        expectedBehaviour: "Exports finish.",
        currentBehaviour: "Exports time out.",
        stepsToReproduce: "Export a large report.",
        attachments: "",
      })
    )
  })

  it("lets an agent triage a request and needs a person to close it", async () => {
    signInAsStaff()
    vi.mocked(context.api.closeRequest).mockImplementation(async (id) => {
      const request = requests.find((item) => item.id === id)!
      return {
        request: {
          ...request,
          linearStateType: "completed",
          linearStateName: "Done",
        },
      }
    })
    renderPortal("/requests/request-1", context)
    const panel = await screen.findByRole("region", {
      name: "Request assignment",
    })
    await within(panel).findByText("Jan Dvořák", {
      ignore: '[role="option"]',
    })

    const labels = onPageAgentLabels()
    for (const label of [
      "Severity",
      "Assign request",
      "Reply",
      "Post reply",
      "Close request",
    ]) {
      expect(labels, `${label} is missing from the snapshot`).toContain(label)
    }

    const triage = await agent.act({
      steps: [
        { ref: "Severity", action: "setValue", args: ["Low"] },
        { ref: "Assign request", action: "setValue", args: ["Mia Novak"] },
      ],
    })
    expect(triage.ok, triage.error?.message).toBe(true)
    await waitFor(() => {
      expect(updateRequestSeverity).toHaveBeenCalledWith("request-1", 4)
      expect(context.api.updateRequestAssignee).toHaveBeenCalledWith(
        "request-1",
        "mia"
      )
    })

    const close = {
      steps: [
        { ref: "Close request", action: "press", args: ["Mark resolved"] },
      ],
    }
    expect((await agent.act(close)).ok).toBe(false)
    expect(context.api.closeRequest).not.toHaveBeenCalled()

    approveAgentSteps = true
    const approved = await agent.act(close)
    expect(approved.ok, approved.error?.message).toBe(true)
    await waitFor(() =>
      expect(context.api.closeRequest).toHaveBeenCalledWith(
        "request-1",
        "resolved"
      )
    )
  })

  it("keeps the close dialog open with a message when closing fails", async () => {
    vi.mocked(context.api.closeRequest).mockRejectedValue(
      new Error("Network failure")
    )
    renderPortal("/requests/request-1", context)
    fireEvent.click(
      await screen.findByRole("button", { name: "Close request" })
    )
    const dialog = await screen.findByRole("alertdialog", {
      name: "Close BAS-101?",
    })
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Mark cancelled" })
    )
    expect(
      await within(dialog).findByText(
        "Could not close the request. Try again after a moment."
      )
    ).toBeTruthy()
    expect(context.api.closeRequest).toHaveBeenCalledWith(
      "request-1",
      "canceled"
    )
    fireEvent.click(within(dialog).getByRole("button", { name: "Keep open" }))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    expect(
      document.activeElement ===
        screen.getByRole("button", { name: "Close request" })
    ).toBe(true)
  })

  it("searches teams, resets pagination, and filters requests across pages", async () => {
    requests = Array.from({ length: 12 }, (_, index) =>
      makeRequest({
        id: `request-${index + 1}`,
        title: `Team request ${index + 1}`,
        linearIdentifier: `BAS-${index + 1}`,
      })
    )
    requests[11].linearTeamId = "team-product"
    renderPortal("/", context)
    await screen.findByText("Showing 1–10 of 12")
    fireEvent.click(screen.getByRole("button", { name: "Next" }))
    await screen.findByText("Showing 11–12 of 12")
    fireEvent.click(screen.getByRole("button", { name: "Filter by team" }))
    const teamSearch = await screen.findByRole("combobox", {
      name: "Filter teams",
    })
    fireEvent.input(teamSearch, { target: { value: "prd" } })
    expect(screen.queryByRole("option", { name: "Base" })).toBeNull()
    fireEvent.click(screen.getByRole("option", { name: "Product" }))
    await waitFor(() =>
      expect(fetchRequests).toHaveBeenLastCalledWith({
        page: 0,
        pageSize: 10,
        status: "active",
        severity: [],
        teamId: "team-product",
      })
    )
    await waitFor(() =>
      expect(screen.queryByText("Team request 11")).toBeNull()
    )
    expect(screen.getByText("Team request 12")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Filter by team" }))
    fireEvent.click(await screen.findByRole("option", { name: "All teams" }))
    await screen.findByText("Showing 1–10 of 12")
    expect(screen.getByText("Team request 1")).toBeTruthy()
  })

  it("shows the real assignment and lets staff reassign and unassign a request", async () => {
    signInAsStaff()
    renderPortal("/requests/request-1", context)
    const panel = await screen.findByRole("region", {
      name: "Request assignment",
    })
    await within(panel).findByText("Jan Dvořák")
    expect(within(panel).getByText("Integrations")).toBeTruthy()
    fireEvent.click(
      within(panel).getByRole("combobox", { name: "Assign request" })
    )
    const mia = await screen.findByRole("option", { name: "Mia Novak" })
    fireEvent.pointerDown(mia, { button: 0, pointerType: "mouse" })
    fireEvent.click(mia)
    await within(panel).findByText("Mia Novak")
    expect(context.api.updateRequestAssignee).toHaveBeenCalledWith(
      "request-1",
      "mia"
    )
    fireEvent.click(
      within(panel).getByRole("combobox", { name: "Assign request" })
    )
    const unassigned = await screen.findByRole("option", { name: "Unassigned" })
    fireEvent.pointerDown(unassigned, { button: 0, pointerType: "mouse" })
    fireEvent.click(unassigned)
    await within(panel).findByText("Unassigned")
    expect(context.api.updateRequestAssignee).toHaveBeenLastCalledWith(
      "request-1",
      null
    )
  })

  it("keeps the previous assignee and displays an error when saving fails", async () => {
    signInAsStaff()
    vi.mocked(context.api.updateRequestAssignee).mockRejectedValue(
      new Error("Network failure")
    )
    renderPortal("/requests/request-1", context)
    const panel = await screen.findByRole("region", {
      name: "Request assignment",
    })
    await within(panel).findByText("Jan Dvořák")
    fireEvent.click(
      within(panel).getByRole("combobox", { name: "Assign request" })
    )
    const mia = await screen.findByRole("option", { name: "Mia Novak" })
    fireEvent.pointerDown(mia, { button: 0, pointerType: "mouse" })
    fireEvent.click(mia)
    await within(panel).findByRole("alert")
    const outsideList = { ignore: '[role="option"]' }
    expect(within(panel).getByText("Jan Dvořák", outsideList)).toBeTruthy()
    expect(within(panel).queryByText("Mia Novak", outsideList)).toBeNull()
  })

  it("searches the current page by title or issue identifier and keeps pipeline counts scoped", async () => {
    requests.push(
      makeRequest({
        id: "request-2",
        title: "Webhook delivery is delayed",
        linearIdentifier: "BAS-202",
        linearStateType: "started",
        linearStateName: "In progress",
        severity: null,
      })
    )
    renderPortal("/", context)
    await screen.findByText("Webhook delivery is delayed")
    const search = screen.getByRole("searchbox", {
      name: "Search requests on this page",
    })
    fireEvent.input(search, { target: { value: "webhook" } })
    expect(screen.queryByText("Existing CSV export failure")).toBeNull()
    expect(screen.getByText("Webhook delivery is delayed")).toBeTruthy()
    expect(
      within(
        screen.getByRole("region", { name: "Request pipeline" })
      ).getByText("In progress")
    ).toBeTruthy()
    const pipeline = within(
      screen.getByRole("region", { name: "Request pipeline" })
    )
    expect(pipeline.getAllByText("1")).toHaveLength(2)
    expect(pipeline.getByText("0")).toBeTruthy()
    fireEvent.input(search, { target: { value: "bas-101" } })
    expect(screen.getByText("Existing CSV export failure")).toBeTruthy()
    expect(screen.queryByText("Webhook delivery is delayed")).toBeNull()
    fireEvent.input(search, { target: { value: "no match" } })
    expect(screen.getByText("No matching requests")).toBeTruthy()
    fireEvent.input(search, { target: { value: "" } })
    expect(screen.getByText("Existing CSV export failure")).toBeTruthy()
    expect(screen.getByText("Webhook delivery is delayed")).toBeTruthy()
  })

  it("loads the dashboard, submits a request, and lands on the detail page", async () => {
    renderPortal("/", context)

    expect(
      await screen.findByRole("heading", { name: "1 request in flight" })
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

    fireEvent.input(screen.getByLabelText("Title"), {
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
    fireEvent.click(screen.getByRole("radio", { name: "High" }))
    fireEvent.input(screen.getByLabelText("Expected behaviour"), {
      target: { value: "The CSV export downloads." },
    })
    fireEvent.input(screen.getByLabelText("Current behaviour"), {
      target: { value: "The export returns a 500." },
    })
    fireEvent.drop(screen.getByText("Drop screenshots here or"), {
      dataTransfer: droppedFiles(
        new File(["screenshot"], "export-error.png", { type: "image/png" })
      ),
    })
    await waitFor(() => {
      expect(uploadImage).toHaveBeenCalledWith(
        expect.objectContaining({ name: "export-error.png" })
      )
      expect(screen.getByRole("img", { name: "export-error.png" })).toBeTruthy()
    })
    fireEvent.input(screen.getByLabelText("Steps to reproduce"), {
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
    expect(screen.getByRole("link", { name: "PRD-102" })).toBeTruthy()
    await waitFor(() => expect(fetchRequest).toHaveBeenCalledWith("request-2"))
    expect(await screen.findByText("No Linear comments yet.")).toBeTruthy()
    expect(screen.getByText(/The CSV export downloads/)).toBeTruthy()
    expect(
      screen.getByRole("img", { name: "export-error.png" }).getAttribute("src")
    ).toBe(
      "/api/requests/request-2/assets?url=https%3A%2F%2Fuploads.linear.app%2Fexport-error.png"
    )

    fireEvent.input(screen.getByLabelText("Reply"), {
      target: { value: "More evidence" },
    })
    fireEvent.drop(screen.getByText("Drop screenshots here or"), {
      dataTransfer: droppedFiles(
        new File(["screenshot"], "reply.png", { type: "image/png" })
      ),
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
      dataTransfer: droppedFiles(
        new File(["screenshot"], "updated-view.png", { type: "image/png" })
      ),
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

    // Severity and assignee are staff decisions; customers only see them.
    expect(screen.queryByRole("combobox", { name: "Severity" })).toBeNull()
    expect(
      screen.queryByRole("combobox", { name: "Assign request" })
    ).toBeNull()
    expect(updateRequestSeverity).not.toHaveBeenCalled()
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

function droppedFiles(...files: File[]) {
  return {
    files,
    types: ["Files"],
    items: files.map((file) => ({
      kind: "file",
      type: file.type,
      getAsFile: () => file,
    })),
  }
}
