import { describe, expect, it, vi } from "vitest"

import { createSlackTicket, SlackEmailMissingError } from "../slack/ticket"

type SlackTicketDeps = Parameters<typeof createSlackTicket>[0]

const issue = {
  id: "i",
  identifier: "BAS-1",
  url: "https://l/BAS-1",
  detailsCommentId: null,
  state: { id: "s", name: "Triage", type: "triage" },
}

function deps(email: string | null) {
  return {
    config: { linear: { teamId: "team" } },
    repo: {
      getUserIdByEmail: vi.fn(async () => (email ? "user-1" : null)),
      createRequest: vi.fn(async () => ({ id: "r" })),
    },
    linear: {
      createHelpdeskIssue: vi.fn(async () => issue),
      uploadAsset: vi.fn(async () => ({ assetUrl: "https://cdn/x.png" })),
    },
    slack: {
      getUserEmail: vi.fn(async () => email),
      downloadFile: vi.fn(async () => ({
        bytes: new Uint8Array([1]),
        contentType: "image/png",
      })),
      getPermalink: vi.fn(async () => "https://acme.slack.com/archives/C1/p12"),
    },
    orgAccess: {
      findActiveOrganizationForEmail: vi.fn(async () =>
        email
          ? {
              organizationId: "org-1",
              organizationName: "Example",
              organizationSlug: "example",
              domain: "meiro.io",
            }
          : null
      ),
    },
  }
}

describe("createSlackTicket", () => {
  it("rejects when the slack user has no email", async () => {
    await expect(
      createSlackTicket(deps(null) as unknown as SlackTicketDeps, {
        slackUserId: "U1",
        title: "T",
        description: "D",
        severity: 2,
        channel: "C1",
        threadTs: "1.2",
        files: [],
      })
    ).rejects.toBeInstanceOf(SlackEmailMissingError)
  })

  it("rejects when the slack email domain is not approved", async () => {
    const d = deps("dev@evil.test")
    d.orgAccess.findActiveOrganizationForEmail = vi.fn(async () => null)

    await expect(
      createSlackTicket(d as unknown as SlackTicketDeps, {
        slackUserId: "U1",
        title: "T",
        description: "D",
        severity: 2,
        channel: "C1",
        threadTs: "1.2",
        files: [],
      })
    ).rejects.toMatchObject({ name: "SlackEmailDomainNotAllowedError" })
  })

  it("creates an issue + record, attributes by email, embeds images", async () => {
    const d = deps("dev@meiro.io")
    const result = await createSlackTicket(d as unknown as SlackTicketDeps, {
      slackUserId: "U1",
      title: "Login broken",
      description: "500 on submit",
      severity: 2,
      channel: "C1",
      threadTs: "1.2",
      files: [
        {
          id: "F1",
          name: "shot.png",
          mimetype: "image/png",
          urlPrivate: "https://files/F1",
        },
      ],
    })

    expect(d.linear.createHelpdeskIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        requesterEmail: "dev@meiro.io",
        priority: 2,
        description: expect.stringContaining("![shot.png](https://cdn/x.png)"),
      })
    )
    expect(d.linear.createHelpdeskIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        description: expect.stringContaining(
          "Slack thread: https://acme.slack.com/archives/C1/p12"
        ),
      })
    )
    expect(d.slack.getPermalink).toHaveBeenCalledWith({
      channel: "C1",
      messageTs: "1.2",
    })
    expect(d.repo.createRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        requesterUserId: "user-1",
        organizationId: "org-1",
        requesterEmail: "dev@meiro.io",
        source: "slack",
        slackChannelId: "C1",
        slackMessageTs: "1.2",
      })
    )
    expect(result.issue.identifier).toBe("BAS-1")
  })

  it("still creates the ticket if an image download fails", async () => {
    const d = deps("dev@meiro.io")
    d.slack.downloadFile = vi.fn(async () => {
      throw new Error("403")
    })
    const result = await createSlackTicket(d as unknown as SlackTicketDeps, {
      slackUserId: "U1",
      title: "T",
      description: "D",
      severity: 3,
      channel: "C1",
      threadTs: "1.2",
      files: [
        { id: "F1", name: "x.png", mimetype: "image/png", urlPrivate: "u" },
      ],
    })
    expect(result.droppedImages).toBe(1)
    expect(d.linear.createHelpdeskIssue).toHaveBeenCalled()
  })
})
