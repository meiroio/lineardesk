import { describe, expect, it } from "vitest"

import { toRequestRecord } from "../repository"

describe("toRequestRecord", () => {
  it("defaults unknown source to web and carries slack fields", () => {
    const record = toRequestRecord({
      id: "r", requesterUserId: null, requesterEmail: "a@b.com",
      title: "t", description: "d", linearIssueId: "i", linearIdentifier: "BAS-1",
      linearUrl: "u", linearTeamId: "team", linearStateId: "s",
      linearStateName: "Triage", linearStateType: "triage", severity: 3,
      linearDetailsCommentId: null, linearDetailsCommentedAt: null,
      source: "slack", slackChannelId: "C1", slackMessageTs: "123.45",
      createdAt: new Date(0), updatedAt: new Date(0), lastLinearSyncedAt: new Date(0),
    } as never)
    expect(record.source).toBe("slack")
    expect(record.slackChannelId).toBe("C1")
    expect(record.requesterUserId).toBeNull()
  })

  it("coerces an unknown source to web", () => {
    const record = toRequestRecord({
      id: "r", requesterUserId: "u", requesterEmail: "a@b.com",
      title: "t", description: "d", linearIssueId: "i", linearIdentifier: "BAS-2",
      linearUrl: "u", linearTeamId: "team", linearStateId: "s",
      linearStateName: "Triage", linearStateType: "triage", severity: null,
      linearDetailsCommentId: null, linearDetailsCommentedAt: null,
      source: "something_else", slackChannelId: null, slackMessageTs: null,
      createdAt: new Date(0), updatedAt: new Date(0), lastLinearSyncedAt: new Date(0),
    } as never)
    expect(record.source).toBe("web")
  })
})
