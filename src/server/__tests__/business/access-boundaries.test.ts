import { describe, expect, it, vi } from "vitest"

import { makeBusinessWorld } from "./world"

const validRequestBody = {
  title: "Export CSV fails",
  severity: "high",
  expectedBehaviour: "The CSV file downloads.",
  currentBehaviour: "The export returns a 500.",
  stepsToReproduce: "Open Reports, then click Export CSV.",
}

type BusinessWorld = ReturnType<typeof makeBusinessWorld>

function addAcme(world: BusinessWorld) {
  world.addOrganization({
    id: "org-acme",
    name: "Acme",
    slug: "acme",
    domains: ["example.com"],
  })
}

async function createRequest(world: BusinessWorld, session: string) {
  const response = await world.postJson("/requests", validRequestBody, session)
  expect(response.status).toBe(201)
  return (await response.json()) as {
    request: { id: string; linearIssueId: string; linearIdentifier: string }
  }
}

describe("customer request access and boundary flows", () => {
  it("rejects unauthenticated, unapproved, and ambiguous organization access", async () => {
    const world = makeBusinessWorld()
    addAcme(world)
    world.addOrganization({
      id: "org-beta",
      name: "Beta",
      slug: "beta",
      domains: ["beta.test"],
    })

    const unauthenticatedResponse = await world.get("/requests")
    expect(unauthenticatedResponse.status).toBe(401)
    await expect(unauthenticatedResponse.json()).resolves.toEqual({
      error: "unauthorized",
    })

    const outsiderSession = world.signIn({
      id: "user-outsider",
      email: "outsider@unknown.test",
    })
    const forbiddenResponse = await world.postJson(
      "/requests",
      validRequestBody,
      outsiderSession
    )
    expect(forbiddenResponse.status).toBe(403)
    await expect(forbiddenResponse.json()).resolves.toEqual({
      error: "forbidden_org",
    })

    const multiOrgSession = world.signIn({
      id: "user-multi",
      email: "multi@neutral.test",
    })
    world.addMembership({ userId: "user-multi", organizationId: "org-acme" })
    world.addMembership({ userId: "user-multi", organizationId: "org-beta" })

    const ambiguousResponse = await world.get("/requests", multiOrgSession)
    expect(ambiguousResponse.status).toBe(409)
    await expect(ambiguousResponse.json()).resolves.toEqual({
      error: "multiple_organizations",
    })
  })

  it("rejects invalid customer input before creating Linear side effects", async () => {
    const world = makeBusinessWorld()
    addAcme(world)
    const session = world.signIn({
      id: "user-ada",
      email: "ada@example.com",
    })

    const invalidCreateResponse = await world.postJson(
      "/requests",
      {
        title: " ",
        severity: "blocked",
        expectedBehaviour: "",
        currentBehaviour: "",
        stepsToReproduce: "",
      },
      session
    )
    expect(invalidCreateResponse.status).toBe(400)
    await expect(invalidCreateResponse.json()).resolves.toMatchObject({
      error: "validation_error",
      issues: expect.arrayContaining([
        "Title must be at least 3 characters",
        "Expected behaviour is required",
        "Current behaviour is required",
        "Steps to reproduce is required",
        "Severity must be one of: urgent, high, medium, low",
      ]),
    })
    expect(world.linearCreateInputs).toEqual([])

    const created = await createRequest(world, session)
    const invalidCommentResponse = await world.postJson(
      `/requests/${created.request.id}/comments`,
      { body: " " },
      session
    )
    expect(invalidCommentResponse.status).toBe(400)
    await expect(invalidCommentResponse.json()).resolves.toEqual({
      error: "validation_error",
      issues: ["Comment must not be empty"],
    })
    expect(world.issueComments.get(created.request.linearIssueId)).toEqual([])
  })

  it("ignores duplicate Linear webhooks without applying later payload drift", async () => {
    const world = makeBusinessWorld()
    addAcme(world)
    const session = world.signIn({
      id: "user-ada",
      email: "ada@example.com",
    })
    const created = await createRequest(world, session)

    const webhookBase = {
      type: "Issue",
      action: "update",
      webhookId: "webhook-dup",
      webhookTimestamp: 10,
      data: {
        id: created.request.linearIssueId,
        identifier: created.request.linearIdentifier,
        url: "https://linear.app/base/issue/BAS-101",
      },
    }

    const firstResponse = await world.postJson("/linear/webhook", {
      ...webhookBase,
      data: {
        ...webhookBase.data,
        state: {
          id: "state-started",
          name: "In Progress",
          type: "started",
        },
      },
    })
    expect(firstResponse.status).toBe(200)

    const duplicateResponse = await world.postJson("/linear/webhook", {
      ...webhookBase,
      data: {
        ...webhookBase.data,
        state: {
          id: "state-completed",
          name: "Done",
          type: "completed",
        },
      },
    })
    expect(duplicateResponse.status).toBe(200)
    await expect(duplicateResponse.json()).resolves.toEqual({
      ok: true,
      duplicate: true,
    })

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

  it("processes duplicate Slack mention deliveries only once", async () => {
    const world = makeBusinessWorld()
    addAcme(world)
    world.setSlackUserEmail("U1", "ada@example.com")
    world.setSlackThread("C1", "123.45", [
      {
        user: "U1",
        text: "CSV export is returning a 500",
      },
    ])
    const payload = {
      type: "event_callback",
      event_id: "Ev-duplicate",
      event: {
        type: "app_mention",
        user: "U1",
        channel: "C1",
        ts: "123.45",
      },
    }

    const firstResponse = await world.postSlackEvent(payload)
    const duplicateResponse = await world.postSlackEvent(payload)

    expect(firstResponse.status).toBe(200)
    expect(duplicateResponse.status).toBe(200)
    expect(world.requests.size).toBe(1)
    expect(world.linearCreateInputs).toHaveLength(1)
    expect(world.slackPosts).toHaveLength(1)
  })

  it("posts a Slack failure without creating a request for unapproved email domains", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      const world = makeBusinessWorld()
      addAcme(world)
      world.setSlackUserEmail("U1", "mallory@unknown.test")
      world.setSlackThread("C1", "123.45", [
        {
          user: "U1",
          text: "CSV export is returning a 500",
        },
      ])

      const response = await world.postSlackEvent({
        type: "event_callback",
        event_id: "Ev-unapproved",
        event: {
          type: "app_mention",
          user: "U1",
          channel: "C1",
          ts: "123.45",
        },
      })

      expect(response.status).toBe(200)
      expect(world.requests.size).toBe(0)
      expect(world.linearCreateInputs).toEqual([])
      expect(world.slackPosts).toEqual([
        expect.objectContaining({
          channel: "C1",
          threadTs: "123.45",
          text: expect.stringContaining("email domain is not approved"),
        }),
      ])
    } finally {
      consoleError.mockRestore()
    }
  })
})
