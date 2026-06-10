import { describe, expect, it } from "vitest"

import {
  buildLinearIssueCommentInput,
  buildLinearIssueInput,
  buildRequesterReplyCommentBody,
  selectDetailsCommentId,
  requireIssueLabelByName,
  selectIssueLabelByName,
  selectWorkflowStateByName,
} from "../linear"

describe("buildLinearIssueInput", () => {
  it("targets the configured team/state/label without assigning a project", () => {
    const input = buildLinearIssueInput({
      title: "Cannot export invoices",
      description: "The export button spins forever.",
      requesterEmail: "user@example.com",
      teamId: "team-id",
      stateId: "state-id",
      labelId: "label-id",
    })

    expect(input).toMatchObject({
      title: "Cannot export invoices",
      teamId: "team-id",
      stateId: "state-id",
      labelIds: ["label-id"],
    })
    expect(input).not.toHaveProperty("projectId")
    expect(input.description).toContain("user@example.com")
    expect(input.description).toContain("The export button spins forever.")
  })

  it("omits labelIds when the label is unavailable", () => {
    const input = buildLinearIssueInput({
      title: "Question",
      description: "How do I invite a teammate?",
      requesterEmail: "user@example.com",
      teamId: "team-id",
      stateId: "state-id",
      labelId: null,
    })

    expect(input).not.toHaveProperty("labelIds")
  })
})

describe("buildLinearIssueCommentInput", () => {
  it("creates a Linear issue comment with requester and submitted details", () => {
    const input = buildLinearIssueCommentInput({
      issueId: "issue-id",
      description: "The export button spins forever.",
      requesterEmail: "user@example.com",
    })

    expect(input).toEqual({
      issueId: "issue-id",
      body: "Requester: user@example.com\n\nThe export button spins forever.\n\n---\nLinearDesk details comment: issue-id",
    })
  })

  it("finds an existing LinearDesk details comment by marker", () => {
    expect(
      selectDetailsCommentId(
        [
          { id: "other-comment-id", body: "Requester: another@example.com" },
          {
            id: "comment-id",
            body: "Requester: user@example.com\n\nDetails\n\n---\nLinearDesk details comment: issue-id",
          },
        ],
        "issue-id"
      )
    ).toBe("comment-id")
  })
})

describe("buildRequesterReplyCommentBody", () => {
  it("attributes requester replies before the submitted body", () => {
    expect(
      buildRequesterReplyCommentBody({
        requesterEmail: "person@example.com",
        body: "Is it still broken?",
      })
    ).toBe("Requester: person@example.com\n\nIs it still broken?")
  })
})

describe("Linear lookup helpers", () => {
  it("selects workflow states by exact name and team id", () => {
    const states = [
      { id: "wrong-case", name: "triage", type: "triage", teamId: "team-id" },
      {
        id: "wrong-team",
        name: "Triage",
        type: "triage",
        teamId: "other-team",
      },
      { id: "state-id", name: "Triage", type: "triage", teamId: "team-id" },
    ]

    expect(selectWorkflowStateByName(states, "Triage", "team-id")).toEqual(
      states[2]
    )
  })

  it("selects labels by exact name", () => {
    const labels = [
      { id: "wrong-case", name: "bug" },
      { id: "label-id", name: "Bug" },
    ]

    expect(selectIssueLabelByName(labels, "Bug")).toEqual(labels[1])
  })

  it("requires the configured Linear issue label", () => {
    expect(() => requireIssueLabelByName([], "Bug", "team-id")).toThrow(
      'Linear issue label "Bug" was not found for team team-id'
    )
  })
})
