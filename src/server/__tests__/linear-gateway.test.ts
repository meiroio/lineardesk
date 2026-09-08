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

describe("downloadAsset", () => {
  it("downloads a private Linear image with the app access token", async () => {
    const fetchMock = vi.fn(
      async (url: RequestInfo | URL, init?: RequestInit) => {
        if (isTokenRequest(url)) return createTokenResponse()
        expect(String(url)).toBe("https://uploads.linear.app/asset/shot.png")
        expect(new Headers(init?.headers).get("authorization")).toBe(
          "Bearer linear-app-token"
        )
        return new Response(new Uint8Array([1, 2, 3]), {
          headers: { "content-type": "image/png" },
        })
      }
    )
    global.fetch = fetchMock

    await expect(
      createLinearGateway(config).downloadAsset(
        "https://uploads.linear.app/asset/shot.png"
      )
    ).resolves.toEqual({
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "image/png",
    })
  })

  it("rejects non-Linear asset URLs", async () => {
    await expect(
      createLinearGateway(config).downloadAsset("https://example.com/shot.png")
    ).rejects.toThrow("Linear asset URL is not allowed")
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

describe("comment queries", () => {
  it("loads 50 comment authors in one query and preserves author fallbacks", async () => {
    const nodes = Array.from({ length: 50 }, (_, index) => ({
      id: `comment-${index}`,
      body: `Reply ${index}`,
      createdAt: new Date(index * 1000).toISOString(),
      botActor: index === 0 ? { userDisplayName: "Desk", name: "Bot" } : null,
      user:
        index === 1
          ? null
          : { displayName: index === 2 ? "" : "Support", name: "Teammate" },
    })).reverse()
    const request = vi.fn(async () => ({
      comments: {
        nodes,
        pageInfo: { hasNextPage: false, endCursor: "comment-49" },
      },
    }))
    vi.mocked(LinearClient).mockImplementation(function () {
      return { client: { request } } as unknown as LinearClient
    })

    const comments =
      await createLinearGateway(config).listIssueComments("issue-1")

    expect(request).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining("user { displayName name }"),
      { issueId: "issue-1", after: null }
    )
    expect(comments).toHaveLength(50)
    expect(comments.slice(0, 3).map((comment) => comment.authorName)).toEqual([
      "Desk",
      "Linear",
      "Teammate",
    ])
    expect(comments[0].createdAt).toEqual(new Date(0))
    expect(comments.at(-1)?.id).toBe("comment-49")
  })

  it("follows comment cursors and sorts the complete conversation", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        comments: {
          nodes: Array.from({ length: 50 }, (_, index) => ({
            id: `comment-${index + 1}`,
            body: "Reply",
            createdAt: new Date((index + 1) * 1000).toISOString(),
            user: { name: "Support" },
          })),
          pageInfo: { hasNextPage: true, endCursor: "next-page" },
        },
      })
      .mockResolvedValueOnce({
        comments: {
          nodes: [
            {
              id: "comment-0",
              body: "First",
              createdAt: new Date(0).toISOString(),
            },
          ],
          pageInfo: { hasNextPage: false, endCursor: "last" },
        },
      })
    vi.mocked(LinearClient).mockImplementation(function () {
      return { client: { request } } as unknown as LinearClient
    })

    const comments =
      await createLinearGateway(config).listIssueComments("issue-1")

    expect(comments).toHaveLength(51)
    expect(comments[0].id).toBe("comment-0")
    expect(request).toHaveBeenCalledTimes(2)
    expect(request).toHaveBeenLastCalledWith(expect.any(String), {
      issueId: "issue-1",
      after: "next-page",
    })
  })

  it.each([
    ["issue-1", "comment-1", "![Image](https://uploads.linear.app/image.png)"],
    ["other-issue", "comment-1", null],
    ["issue-1", "missing-comment", null],
  ] as const)(
    "only reads the body for its owning issue: %s / %s",
    async (issueId, commentId, expected) => {
      const body = "![Image](https://uploads.linear.app/image.png)"
      const request = vi.fn(
        async (
          _query: string,
          variables: { issueId: string; commentId: string }
        ) => ({
          comments: {
            nodes:
              variables.issueId === "issue-1" &&
              variables.commentId === "comment-1"
                ? [{ body }]
                : [],
          },
        })
      )
      vi.mocked(LinearClient).mockImplementation(function () {
        return { client: { request } } as unknown as LinearClient
      })

      await expect(
        createLinearGateway(config).getIssueCommentBody(issueId, commentId)
      ).resolves.toBe(expected)

      expect(request).toHaveBeenCalledExactlyOnceWith(
        expect.stringContaining("issue: { id: { eq: $issueId } }"),
        { issueId, commentId }
      )
      expect(request.mock.calls[0][0]).toContain("id: { eq: $commentId }")
      expect(request.mock.calls[0][0]).not.toContain("user {")
    }
  )

  it("resolves a created comment's SDK user getter once and catches rejection", async () => {
    const user = vi.fn(() => Promise.reject(new Error("Linear rate limit")))
    const comment = {
      id: "comment-1",
      body: "Reply",
      createdAt: new Date(0),
      get user() {
        return user()
      },
    }
    const createComment = vi.fn(async () => ({ success: true, comment }))
    vi.mocked(LinearClient).mockImplementation(function () {
      return { createComment } as unknown as LinearClient
    })

    await expect(
      createLinearGateway(config).createIssueComment({
        issueId: "issue-1",
        body: "Reply",
      })
    ).resolves.toEqual({
      id: "comment-1",
      body: "Reply",
      authorName: "Linear",
      createdAt: new Date(0),
    })
    expect(user).toHaveBeenCalledOnce()
  })
})

describe("issue state queries", () => {
  it("loads 200 inline states with one query", async () => {
    const nodes = Array.from({ length: 200 }, (_, index) => ({
      id: `issue-${index}`,
      identifier: `DESK-${index}`,
      url: `https://linear.app/acme/issue/DESK-${index}`,
      state: { id: "triage", name: "Triage", type: "triage" },
    }))
    const request = vi.fn(async () => ({ issues: { nodes } }))
    vi.mocked(LinearClient).mockImplementation(function () {
      return { client: { request } } as unknown as LinearClient
    })

    await expect(
      createLinearGateway(config).listIssueStates(
        nodes.map((issue) => issue.id)
      )
    ).resolves.toEqual(nodes)
    expect(request).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining("state { id name type }"),
      { issueIds: nodes.map((issue) => issue.id) }
    )
  })

  it("splits more than 250 IDs into complete batches", async () => {
    const ids = Array.from({ length: 251 }, (_, index) => `issue-${index}`)
    const request = vi.fn(
      async (_query: string, { issueIds }: { issueIds: string[] }) => ({
        issues: {
          nodes: issueIds.map((id) => ({
            id,
            identifier: id,
            url: "url",
            state: { id: "triage", name: "Triage", type: "triage" },
          })),
        },
      })
    )
    vi.mocked(LinearClient).mockImplementation(function () {
      return { client: { request } } as unknown as LinearClient
    })

    const states = await createLinearGateway(config).listIssueStates(ids)

    expect(states.map((issue) => issue.id)).toEqual(ids)
    expect(request).toHaveBeenCalledTimes(2)
    expect(
      request.mock.calls.map(([, variables]) => variables.issueIds.length)
    ).toEqual([250, 1])
  })

  it("does not authenticate or query for an empty batch", async () => {
    await expect(
      createLinearGateway(config).listIssueStates([])
    ).resolves.toEqual([])
    expect(global.fetch).not.toHaveBeenCalled()
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
