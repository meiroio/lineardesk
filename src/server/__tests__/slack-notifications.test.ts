import { describe, expect, it, vi } from "vitest"

import { notifyRequestCreator } from "../slack/notifications"
import type { RequestRecord } from "../types"

const request: RequestRecord = {
  id: "request-1",
  requesterUserId: "portal-user",
  organizationId: "org-1",
  requesterEmail: "ada@example.com",
  title: "Export fails",
  description: "The CSV export fails.",
  linearIssueId: "issue-1",
  linearIdentifier: "BAS-101",
  linearUrl: "https://linear.app/acme/issue/BAS-101",
  linearTeamId: "team-1",
  linearStateId: "triage",
  linearStateName: "Triage",
  linearStateType: "triage",
  severity: 2,
  linearDetailsCommentId: null,
  linearDetailsCommentedAt: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  lastLinearSyncedAt: new Date(0),
  source: "slack",
  slackChannelId: "C1",
  slackMessageTs: "123.45",
}

describe("notifyRequestCreator", () => {
  it("mentions the creator in the originating Slack thread", async () => {
    const postMessage = vi.fn(async () => ({ channel: "C1", ts: "124" }))

    await expect(
      notifyRequestCreator({
        slack: {
          findUserIdByEmail: vi.fn(async () => "U1"),
          postMessage,
        },
        request,
        baseUrl: "https://desk.example.com/",
        change: {
          kind: "comment",
          action: "create",
          linearIssueId: "issue-1",
          actorName: "Grace Hopper",
          commentId: "comment-1",
          body: "Fixed in staging. Please retry.",
        },
      })
    ).resolves.toBe(true)

    expect(postMessage).toHaveBeenCalledWith({
      channel: "C1",
      threadTs: "123.45",
      text: expect.stringMatching(
        /<@U1>.*Grace Hopper.*commented.*BAS-101[\s\S]*Fixed in staging[\s\S]*desk\.example\.com\/requests\/request-1/
      ),
    })
  })

  it("sends web-created request notifications to the creator's Slack App Home", async () => {
    const postMessage = vi.fn(async () => ({ channel: "U1", ts: "124" }))

    await notifyRequestCreator({
      slack: {
        findUserIdByEmail: vi.fn(async () => "U1"),
        postMessage,
      },
      request: {
        ...request,
        source: "web",
        slackChannelId: null,
        slackMessageTs: null,
      },
      baseUrl: "https://desk.example.com",
      change: {
        kind: "issue",
        action: "update",
        linearIssueId: "issue-1",
        actorName: "Grace Hopper",
        stateId: "started",
        stateName: "In Progress",
      },
    })

    expect(postMessage).toHaveBeenCalledWith({
      channel: "U1",
      threadTs: undefined,
      text: expect.stringContaining("moved *BAS-101* to *In Progress*"),
    })
  })
})
