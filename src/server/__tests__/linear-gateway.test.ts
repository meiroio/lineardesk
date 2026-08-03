import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { LinearClient } from "@linear/sdk"

import { createLinearGateway } from "../linear"

vi.mock("@linear/sdk", () => ({
  LinearClient: vi.fn(),
}))

const config = {
  clientId: "linear-client",
  clientSecret: "linear-secret",
  teamId: "team-id",
  teamKey: "BAS",
  initialStateName: "Triage",
  labelName: "Bug",
  webhookSecret: "secret",
}

const LINEAR_OAUTH_TOKEN_URL = "https://api.linear.app/oauth/token"
const fileUpload = vi.fn()
const originalFetch = global.fetch

function createTokenResponse() {
  return Response.json({
    access_token: "linear-app-token",
    token_type: "Bearer",
    expires_in: 2_591_999,
    scope: "read write",
  })
}

function isTokenRequest(input: RequestInfo | URL) {
  return String(input) === LINEAR_OAUTH_TOKEN_URL
}

beforeEach(() => {
  fileUpload.mockReset()
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    if (isTokenRequest(input)) return createTokenResponse()
    throw new Error(`Unexpected fetch: ${String(input)}`)
  })
  vi.mocked(LinearClient).mockImplementation(function () {
    return { fileUpload } as unknown as LinearClient
  })
})

afterEach(() => {
  global.fetch = originalFetch
  vi.restoreAllMocks()
})

describe("uploadAsset", () => {
  it("uploads bytes to the pre-signed URL and returns the asset URL", async () => {
    fileUpload.mockResolvedValue({
      uploadFile: {
        uploadUrl: "https://upload.example/put",
        assetUrl: "https://assets.example/abc.png",
        headers: [{ key: "x-amz-acl", value: "private" }],
      },
    })
    const fetchMock = vi.fn(
      async (url: RequestInfo | URL, _init?: RequestInit) =>
        isTokenRequest(url)
          ? createTokenResponse()
          : new Response(null, { status: 200 })
    )
    global.fetch = fetchMock

    const gateway = createLinearGateway(config)
    const result = await gateway.uploadAsset({
      contentType: "image/png",
      filename: "shot.png",
      bytes: new Uint8Array([1, 2, 3]),
    })

    expect(result).toEqual({ assetUrl: "https://assets.example/abc.png" })
    expect(fileUpload).toHaveBeenCalledWith("image/png", "shot.png", 3)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [url, init] = fetchMock.mock.calls[1]
    expect(url).toBe("https://upload.example/put")
    expect(init?.method).toBe("PUT")
    const headers = new Headers(init?.headers)
    expect(headers.get("content-type")).toBe("image/png")
    expect(headers.get("x-amz-acl")).toBe("private")
  })

  it("throws when Linear cannot prepare the upload", async () => {
    fileUpload.mockResolvedValue({ uploadFile: null })

    const gateway = createLinearGateway(config)
    await expect(
      gateway.uploadAsset({
        contentType: "image/png",
        filename: "x.png",
        bytes: new Uint8Array([1]),
      })
    ).rejects.toThrow("Linear file upload could not be prepared")
  })

  it("throws when the upload PUT fails", async () => {
    fileUpload.mockResolvedValue({
      uploadFile: {
        uploadUrl: "https://upload.example/put",
        assetUrl: "https://assets.example/abc.png",
        headers: [],
      },
    })
    global.fetch = vi.fn(async (url: RequestInfo | URL) =>
      isTokenRequest(url)
        ? createTokenResponse()
        : new Response(null, { status: 500 })
    )

    const gateway = createLinearGateway(config)
    await expect(
      gateway.uploadAsset({
        contentType: "image/png",
        filename: "x.png",
        bytes: new Uint8Array([1]),
      })
    ).rejects.toThrow("Linear asset upload failed with status 500")
  })
})

describe("app authentication", () => {
  it("exchanges app credentials and authenticates the SDK with the access token", async () => {
    const request = vi.fn(async () => ({ teams: { nodes: [] } }))
    vi.mocked(LinearClient).mockImplementation(function () {
      return { client: { request } } as unknown as LinearClient
    })

    await createLinearGateway(config).listTeams()

    expect(global.fetch).toHaveBeenCalledWith(
      LINEAR_OAUTH_TOKEN_URL,
      expect.objectContaining({
        method: "POST",
        body: new URLSearchParams({
          grant_type: "client_credentials",
          scope: "read,write",
          client_id: "linear-client",
          client_secret: "linear-secret",
        }),
      })
    )
    expect(LinearClient).toHaveBeenCalledWith({
      accessToken: "linear-app-token",
    })
  })
})

describe("teams and issue creation", () => {
  it("lists active teams in display-name order", async () => {
    const request = vi.fn(async () => ({
      teams: {
        nodes: [
          {
            id: "team-product",
            key: "PRD",
            displayName: "Product",
            retiredAt: null,
          },
          {
            id: "team-archived",
            key: "OLD",
            displayName: "Archived",
            retiredAt: "2026-08-03T00:00:00.000Z",
          },
          {
            id: "team-base",
            key: "BAS",
            displayName: "Base",
            retiredAt: null,
          },
        ],
      },
    }))
    vi.mocked(LinearClient).mockImplementation(function () {
      return { client: { request } } as unknown as LinearClient
    })

    await expect(createLinearGateway(config).listTeams()).resolves.toEqual([
      { id: "team-base", key: "BAS", name: "Base" },
      { id: "team-product", key: "PRD", name: "Product" },
    ])
  })

  it("creates the issue with the selected team's state and label", async () => {
    const workflowStates = vi.fn(async () => ({
      nodes: [
        {
          id: "base-triage",
          name: "Triage",
          type: "triage",
          teamId: "team-id",
        },
        {
          id: "product-triage",
          name: "Triage",
          type: "triage",
          teamId: "team-product",
        },
      ],
    }))
    const issueLabels = vi.fn(async () => ({
      nodes: [
        { id: "base-bug", name: "Bug", teamId: "team-id" },
        { id: "product-bug", name: "Bug", teamId: "team-product" },
      ],
    }))
    const createIssue = vi.fn(async () => ({
      success: true,
      issue: {
        id: "issue-product",
        identifier: "PRD-123",
        url: "https://linear.app/acme/issue/PRD-123",
        state: {
          id: "product-triage",
          name: "Triage",
          type: "triage",
        },
      },
    }))
    vi.mocked(LinearClient).mockImplementation(function () {
      return {
        workflowStates,
        issueLabels,
        createIssue,
      } as unknown as LinearClient
    })

    const issue = await createLinearGateway(config).createHelpdeskIssue({
      title: "Product bug",
      description: "It broke",
      requesterEmail: "person@example.com",
      teamId: "team-product",
    })

    expect(createIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        teamId: "team-product",
        stateId: "product-triage",
        labelIds: ["product-bug"],
      })
    )
    expect(issue.identifier).toBe("PRD-123")
  })
})

describe("closeIssue", () => {
  const states = {
    nodes: [
      { id: "done-state", name: "Done", type: "completed", teamId: "team-id" },
      {
        id: "cancel-state",
        name: "Canceled",
        type: "canceled",
        teamId: "team-id",
      },
    ],
  }

  it("moves the issue to a completed state when resolved", async () => {
    const workflowStates = vi.fn(async () => states)
    const updateIssue = vi.fn(async () => ({ success: true, issue: null }))
    vi.mocked(LinearClient).mockImplementation(function () {
      return { workflowStates, updateIssue } as unknown as LinearClient
    })

    const gateway = createLinearGateway(config)
    const result = await gateway.closeIssue({
      issueId: "issue-1",
      teamId: "team-id",
      resolution: "resolved",
    })

    expect(updateIssue).toHaveBeenCalledWith("issue-1", {
      stateId: "done-state",
    })
    expect(result).toEqual({
      id: "done-state",
      name: "Done",
      type: "completed",
    })
  })

  it("moves the issue to a canceled state when canceled", async () => {
    const workflowStates = vi.fn(async () => states)
    const updateIssue = vi.fn(async () => ({ success: true, issue: null }))
    vi.mocked(LinearClient).mockImplementation(function () {
      return { workflowStates, updateIssue } as unknown as LinearClient
    })

    const gateway = createLinearGateway(config)
    const result = await gateway.closeIssue({
      issueId: "issue-1",
      teamId: "team-id",
      resolution: "canceled",
    })

    expect(updateIssue).toHaveBeenCalledWith("issue-1", {
      stateId: "cancel-state",
    })
    expect(result.type).toBe("canceled")
  })

  it("throws when no matching workflow state exists", async () => {
    const workflowStates = vi.fn(async () => ({ nodes: [] }))
    const updateIssue = vi.fn()
    vi.mocked(LinearClient).mockImplementation(function () {
      return { workflowStates, updateIssue } as unknown as LinearClient
    })

    const gateway = createLinearGateway(config)
    await expect(
      gateway.closeIssue({
        issueId: "issue-1",
        teamId: "team-id",
        resolution: "resolved",
      })
    ).rejects.toThrow('Linear workflow state of type "completed"')
    expect(updateIssue).not.toHaveBeenCalled()
  })
})
