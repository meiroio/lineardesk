import { describe, expect, it, vi } from "vitest"

import { reconcileOpenRequests } from "../reconcile"
import type {
  HelpdeskRepository,
  IssueStateSnapshot,
  LinearGateway,
  RequestRecord,
} from "../types"

function makeRecord(overrides: Partial<RequestRecord> = {}): RequestRecord {
  return {
    id: "r1",
    requesterUserId: "u1",
    organizationId: "org-1",
    requesterEmail: "person@meiro.io",
    title: "Title",
    description: "Body",
    linearIssueId: "issue-1",
    linearIdentifier: "BAS-1",
    linearUrl: "https://linear.app/acme/issue/BAS-1",
    linearTeamId: "team-id",
    linearStateId: "state-triage",
    linearStateName: "Triage",
    linearStateType: "triage",
    severity: 3,
    linearDetailsCommentId: null,
    linearDetailsCommentedAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    lastLinearSyncedAt: new Date("2026-01-01T00:00:00.000Z"),
    source: "web",
    slackChannelId: null,
    slackMessageTs: null,
    ...overrides,
  }
}

function makeRepo(open: RequestRecord[]): HelpdeskRepository {
  return {
    createRequest: vi.fn(async () => makeRecord()),
    getUserIdByEmail: vi.fn(async () => "u1"),
    listRequestsForOrganization: vi.fn(async () => ({
      requests: [],
      total: 0,
    })),
    getRequestForOrganization: vi.fn(async () => null),
    getRequestByLinearIssueId: vi.fn(async () => null),
    listOpenRequests: vi.fn(async () => open),
    applyWebhookEvent: vi.fn(async () => true),
    markRequestsSynced: vi.fn(async () => undefined),
    claimSlackEvent: vi.fn(async () => true),
    releaseSlackEvent: vi.fn(async () => undefined),
    updateRequestFromLinear: vi.fn(async () => undefined),
    updateRequestFields: vi.fn(async () => makeRecord()),
    updateRequestSeverity: vi.fn(async () => makeRecord()),
  }
}

function makeLinear(states: IssueStateSnapshot[]): LinearGateway {
  return {
    getIssueAssignment: vi.fn(async () => ({
      assignee: null,
      project: null,
      team: { id: "team-id", name: "Base" },
    })),
    listTeamAssignees: vi.fn(async () => []),
    updateIssueAssignee: vi.fn(async () => undefined),
    listTeams: vi.fn(async () => []),
    createHelpdeskIssue: vi.fn(),
    createIssueComment: vi.fn(),
    listIssueComments: vi.fn(async () => []),
    getIssueCommentBody: vi.fn(async () => null),
    listIssueStates: vi.fn(async () => states),
    uploadAsset: vi.fn(),
    downloadAsset: vi.fn(),
    closeIssue: vi.fn(),
    updateIssueFields: vi.fn(),
    updateIssuePriority: vi.fn(),
  }
}

describe("reconcileOpenRequests", () => {
  it("updates only requests whose Linear state drifted", async () => {
    const repo = makeRepo([
      makeRecord({
        id: "r1",
        linearIssueId: "issue-1",
        linearStateId: "state-triage",
      }),
      makeRecord({
        id: "r2",
        linearIssueId: "issue-2",
        linearStateId: "state-started",
      }),
    ])
    const linear = makeLinear([
      {
        id: "issue-1",
        identifier: "BAS-1",
        url: "https://linear.app/acme/issue/BAS-1",
        state: { id: "state-done", name: "Done", type: "completed" },
      },
      {
        id: "issue-2",
        identifier: "BAS-2",
        url: "https://linear.app/acme/issue/BAS-2",
        state: { id: "state-started", name: "In Progress", type: "started" },
      },
    ])

    const result = await reconcileOpenRequests({ repo, linear, limit: 200 })

    expect(result).toEqual({ checked: 2, updated: 1 })
    expect(repo.updateRequestFromLinear).toHaveBeenCalledTimes(1)
    expect(repo.updateRequestFromLinear).toHaveBeenCalledWith(
      expect.objectContaining({
        linearIssueId: "issue-1",
        linearStateType: "completed",
      })
    )
    expect(repo.markRequestsSynced).toHaveBeenCalledWith(
      ["issue-1", "issue-2"],
      expect.any(Date)
    )
  })

  it("does nothing when there are no open requests", async () => {
    const repo = makeRepo([])
    const linear = makeLinear([])

    const result = await reconcileOpenRequests({ repo, linear, limit: 200 })

    expect(result).toEqual({ checked: 0, updated: 0 })
    expect(linear.listIssueStates).not.toHaveBeenCalled()
    expect(repo.markRequestsSynced).not.toHaveBeenCalled()
    expect(repo.updateRequestFromLinear).not.toHaveBeenCalled()
  })

  it("skips requests whose issue is missing from Linear", async () => {
    const repo = makeRepo([makeRecord({ linearIssueId: "issue-x" })])
    const linear = makeLinear([])

    const result = await reconcileOpenRequests({ repo, linear, limit: 200 })

    expect(result).toEqual({ checked: 1, updated: 0 })
    expect(repo.updateRequestFromLinear).not.toHaveBeenCalled()
    expect(repo.markRequestsSynced).toHaveBeenCalledWith(
      ["issue-x"],
      expect.any(Date)
    )
  })

  it("does not advance the scan when the upstream batch fails", async () => {
    const repo = makeRepo([makeRecord()])
    const linear = makeLinear([])
    vi.mocked(linear.listIssueStates).mockRejectedValue(
      new Error("rate limited")
    )
    await expect(
      reconcileOpenRequests({ repo, linear, limit: 200 })
    ).rejects.toThrow("rate limited")
    expect(repo.markRequestsSynced).not.toHaveBeenCalled()
  })
})
