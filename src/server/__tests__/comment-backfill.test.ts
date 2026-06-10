import { describe, expect, it, vi } from "vitest"

import { backfillMissingDetailsComments } from "../comment-backfill"
import type { HelpdeskRepository, LinearGateway, RequestRecord } from "../types"

function makeRequest(overrides: Partial<RequestRecord> = {}): RequestRecord {
  return {
    id: "request-id",
    requesterUserId: "user-id",
    requesterEmail: "person@example.com",
    title: "Cannot sign in",
    description: "Google sign-in fails after redirect.",
    linearIssueId: "linear-issue-id",
    linearIdentifier: "BAS-123",
    linearUrl: "https://linear.app/acme/issue/BAS-123",
    linearTeamId: "team-id",
    linearStateId: "state-id",
    linearStateName: "Triage",
    linearStateType: "triage",
    linearDetailsCommentId: null,
    linearDetailsCommentedAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    lastLinearSyncedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  }
}

function makeRepo(requests: RequestRecord[]): HelpdeskRepository {
  return {
    createRequest: vi.fn(),
    listRequestsForUser: vi.fn(),
    getRequestForUser: vi.fn(),
    listRequestsMissingDetailsComment: vi.fn(async () => requests),
    markDetailsCommentCreated: vi.fn(),
    hasProcessedWebhookEvent: vi.fn(),
    recordWebhookEvent: vi.fn(),
    updateRequestFromLinear: vi.fn(),
  }
}

describe("backfillMissingDetailsComments", () => {
  it("creates missing Linear details comments and stores their comment ids", async () => {
    const request = makeRequest()
    const repo = makeRepo([request])
    const linear: LinearGateway = {
      createHelpdeskIssue: vi.fn(),
      createHelpdeskIssueDetailsComment: vi.fn(async () => ({
        id: "comment-id",
      })),
      createIssueComment: vi.fn(),
      listIssueComments: vi.fn(async () => []),
    }

    const result = await backfillMissingDetailsComments({
      repo,
      linear,
      limit: 25,
    })

    expect(linear.createHelpdeskIssueDetailsComment).toHaveBeenCalledWith({
      issueId: "linear-issue-id",
      description: "Google sign-in fails after redirect.",
      requesterEmail: "person@example.com",
    })
    expect(repo.markDetailsCommentCreated).toHaveBeenCalledWith(
      "request-id",
      "comment-id"
    )
    expect(result).toEqual({ processed: 1, commented: 1, failed: 0 })
  })
})
