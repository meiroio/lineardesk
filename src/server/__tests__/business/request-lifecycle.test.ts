import process from "node:process"

import { describe, expect, it } from "vitest"

import { makeBusinessWorld } from "./world"

describe("customer request business flows", () => {
  it("lets an approved customer create, discuss, and close a request", async () => {
    const world = makeBusinessWorld()
    world.addOrganization({
      id: "org-acme",
      name: "Acme",
      slug: "acme",
      domains: ["example.com"],
    })
    const session = world.signIn({
      id: "user-ada",
      email: "ada@example.com",
      name: "Ada Lovelace",
    })

    const createResponse = await world.postJson(
      "/requests",
      {
        title: " Export CSV fails ",
        severity: "high",
        expectedBehaviour: " The CSV file downloads. ",
        currentBehaviour: " The export returns a 500. ",
        stepsToReproduce: " Open Reports, then click Export CSV. ",
      },
      session
    )
    expect(createResponse.status).toBe(201)
    const created = (await createResponse.json()) as {
      request: { id: string; linearIssueId: string }
    }

    expect(world.linearCreateInputs).toEqual([
      expect.objectContaining({
        title: "Export CSV fails",
        requesterEmail: "ada@example.com",
        priority: 2,
      }),
    ])

    const listResponse = await world.get("/requests", session)
    expect(listResponse.status).toBe(200)
    await expect(listResponse.json()).resolves.toMatchObject({
      requests: [
        {
          id: created.request.id,
          requesterEmail: "ada@example.com",
          organizationId: "org-acme",
          title: "Export CSV fails",
          severity: 2,
          linearStateType: "triage",
          source: "web",
        },
      ],
    })

    const replyResponse = await world.postJson(
      `/requests/${created.request.id}/comments`,
      { body: "Can you prioritize this?" },
      session
    )
    expect(replyResponse.status).toBe(201)

    const detailResponse = await world.get(
      `/requests/${created.request.id}`,
      session
    )
    expect(detailResponse.status).toBe(200)
    await expect(detailResponse.json()).resolves.toMatchObject({
      request: {
        id: created.request.id,
        comments: [
          {
            body: "Requester: ada@example.com\n\nCan you prioritize this?",
            authorName: "LinearDesk",
          },
        ],
      },
    })

    const closeResponse = await world.postJson(
      `/requests/${created.request.id}/close`,
      { resolution: "resolved" },
      session
    )
    expect(closeResponse.status).toBe(200)
    await expect(closeResponse.json()).resolves.toMatchObject({
      request: {
        id: created.request.id,
        linearStateName: "Done",
        linearStateType: "completed",
      },
    })
  })

  it("keeps customer organizations isolated across list and detail views", async () => {
    const world = makeBusinessWorld()
    world.addOrganization({
      id: "org-acme",
      name: "Acme",
      slug: "acme",
      domains: ["example.com"],
    })
    world.addOrganization({
      id: "org-beta",
      name: "Beta",
      slug: "beta",
      domains: ["beta.test"],
    })
    const acmeSession = world.signIn({
      id: "user-acme",
      email: "ada@example.com",
    })
    const betaSession = world.signIn({
      id: "user-beta",
      email: "bea@beta.test",
    })

    const createResponse = await world.postJson(
      "/requests",
      {
        title: "Cannot upload invoices",
        severity: "medium",
        expectedBehaviour: "The invoice uploads.",
        currentBehaviour: "The upload fails.",
        stepsToReproduce: "Open Billing and upload a PDF.",
      },
      acmeSession
    )
    const created = (await createResponse.json()) as { request: { id: string } }

    const betaListResponse = await world.get("/requests", betaSession)
    expect(betaListResponse.status).toBe(200)
    await expect(betaListResponse.json()).resolves.toEqual({ requests: [] })

    const betaDetailResponse = await world.get(
      `/requests/${created.request.id}`,
      betaSession
    )
    expect(betaDetailResponse.status).toBe(404)
    await expect(betaDetailResponse.json()).resolves.toEqual({
      error: "not_found",
    })
  })

  it("sends customer edits to Linear and rejects edits after closure", async () => {
    const world = makeBusinessWorld()
    world.addOrganization({
      id: "org-acme",
      name: "Acme",
      slug: "acme",
      domains: ["example.com"],
    })
    const session = world.signIn({
      id: "user-ada",
      email: "ada@example.com",
    })

    const createResponse = await world.postJson(
      "/requests",
      {
        title: "Export CSV fails",
        severity: "medium",
        expectedBehaviour: "The CSV file downloads.",
        currentBehaviour: "The export returns a 500.",
        stepsToReproduce: "Open Reports, then click Export CSV.",
      },
      session
    )
    const created = (await createResponse.json()) as {
      request: { id: string; linearIssueId: string }
    }

    const description = [
      "Expected behaviour",
      "Large exports finish successfully.",
      "",
      "Current behaviour",
      "Large exports time out.",
      "",
      "Steps to reproduce",
      "Open Reports, select a full year, then export CSV.",
    ].join("\n")
    const updateResponse = await world.postJson(
      `/requests/${created.request.id}/update`,
      {
        title: "Large CSV exports time out",
        description,
        severity: "urgent",
      },
      session
    )
    expect(updateResponse.status).toBe(200)
    await expect(updateResponse.json()).resolves.toMatchObject({
      request: {
        id: created.request.id,
        title: "Large CSV exports time out",
        description,
        severity: 1,
      },
    })
    expect(world.getLinearIssue(created.request.linearIssueId)).toMatchObject({
      title: "Large CSV exports time out",
      description,
      priority: 1,
    })

    const closeResponse = await world.postJson(
      `/requests/${created.request.id}/close`,
      { resolution: "resolved" },
      session
    )
    expect(closeResponse.status).toBe(200)

    const rejectedEditResponse = await world.postJson(
      `/requests/${created.request.id}/update`,
      {
        title: "Reopen CSV export",
        description: "This should not change a closed request.",
        severity: "low",
      },
      session
    )
    expect(rejectedEditResponse.status).toBe(409)
    await expect(rejectedEditResponse.json()).resolves.toEqual({
      error: "ticket_closed",
    })
  })

  it("updates the portal state from a Linear webhook", async () => {
    const world = makeBusinessWorld()
    world.addOrganization({
      id: "org-acme",
      name: "Acme",
      slug: "acme",
      domains: ["example.com"],
    })
    const session = world.signIn({
      id: "user-ada",
      email: "ada@example.com",
    })

    const createResponse = await world.postJson(
      "/requests",
      {
        title: "Report download fails",
        severity: "low",
        expectedBehaviour: "The report downloads.",
        currentBehaviour: "The report page hangs.",
        stepsToReproduce: "Open Reports and click Download.",
      },
      session
    )
    const created = (await createResponse.json()) as {
      request: { id: string; linearIssueId: string; linearIdentifier: string }
    }

    const webhookResponse = await world.postJson("/linear/webhook", {
      type: "Issue",
      action: "update",
      webhookId: "webhook-1",
      webhookTimestamp: 1,
      data: {
        id: created.request.linearIssueId,
        identifier: created.request.linearIdentifier,
        url: "https://linear.app/base/issue/BAS-101",
        state: {
          id: "state-started",
          name: "In Progress",
          type: "started",
        },
      },
    })
    expect(webhookResponse.status).toBe(200)

    const detailResponse = await world.get(
      `/requests/${created.request.id}`,
      session
    )
    await expect(detailResponse.json()).resolves.toMatchObject({
      request: {
        id: created.request.id,
        linearStateId: "state-started",
        linearStateName: "In Progress",
        linearStateType: "started",
      },
    })
  })

  it("reconciles missed Linear state changes from cron", async () => {
    const world = makeBusinessWorld()
    world.addOrganization({
      id: "org-acme",
      name: "Acme",
      slug: "acme",
      domains: ["example.com"],
    })
    const session = world.signIn({
      id: "user-ada",
      email: "ada@example.com",
    })

    const createResponse = await world.postJson(
      "/requests",
      {
        title: "Report download fails",
        severity: "low",
        expectedBehaviour: "The report downloads.",
        currentBehaviour: "The report page hangs.",
        stepsToReproduce: "Open Reports and click Download.",
      },
      session
    )
    const created = (await createResponse.json()) as {
      request: { id: string; linearIssueId: string }
    }
    world.setLinearIssueState(created.request.linearIssueId, {
      id: "state-started",
      name: "In Progress",
      type: "started",
    })

    const previousSecret = process.env.CRON_SECRET
    process.env.CRON_SECRET = "cron-secret"
    try {
      const reconcileResponse = await world.reconcile("cron-secret")
      expect(reconcileResponse.status).toBe(200)
      await expect(reconcileResponse.json()).resolves.toEqual({
        ok: true,
        checked: 1,
        updated: 1,
      })
    } finally {
      if (previousSecret === undefined) {
        delete process.env.CRON_SECRET
      } else {
        process.env.CRON_SECRET = previousSecret
      }
    }

    const detailResponse = await world.get(
      `/requests/${created.request.id}`,
      session
    )
    await expect(detailResponse.json()).resolves.toMatchObject({
      request: {
        id: created.request.id,
        linearStateId: "state-started",
        linearStateName: "In Progress",
        linearStateType: "started",
      },
    })
  })

  it("creates a portal-visible ticket from an approved Slack mention", async () => {
    const world = makeBusinessWorld()
    world.addOrganization({
      id: "org-acme",
      name: "Acme",
      slug: "acme",
      domains: ["example.com"],
    })
    world.setSlackUserEmail("U1", "ada@example.com")
    world.setSlackThread("C1", "123.45", [
      {
        user: "U1",
        text: "CSV export is returning a 500",
      },
    ])

    const slackResponse = await world.postSlackEvent({
      type: "event_callback",
      event_id: "Ev1",
      event: {
        type: "app_mention",
        user: "U1",
        channel: "C1",
        ts: "123.45",
      },
    })
    expect(slackResponse.status).toBe(200)
    expect(world.slackPosts).toEqual([
      expect.objectContaining({
        channel: "C1",
        threadTs: "123.45",
        text: expect.stringContaining("Created *BAS-101*"),
      }),
    ])

    const session = world.signIn({
      id: "user-ada",
      email: "ada@example.com",
    })
    const listResponse = await world.get("/requests", session)
    await expect(listResponse.json()).resolves.toMatchObject({
      requests: [
        {
          title: "CSV export fails",
          requesterEmail: "ada@example.com",
          organizationId: "org-acme",
          source: "slack",
          slackChannelId: "C1",
          slackMessageTs: "123.45",
        },
      ],
    })
  })
})
