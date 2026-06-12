import { describe, expect, it } from "vitest"

import { buildTicketModal, parseTicketSubmission } from "../slack/modal"

describe("buildTicketModal", () => {
  it("builds a modal with prefilled description and private_metadata", () => {
    const view = buildTicketModal({
      descriptionPrefill: "from the thread",
      privateMetadata: { channel: "C1", messageTs: "1.2", threadTs: "1.2", files: [] },
    })
    expect(view.callback_id).toBe("slack_ticket_submit")
    expect(JSON.parse(view.private_metadata).channel).toBe("C1")
    const desc = view.blocks.find((b: { block_id?: string }) => b.block_id === "description")
    expect(JSON.stringify(desc)).toContain("from the thread")
  })
})

describe("parseTicketSubmission", () => {
  it("extracts field values + severity + private_metadata", () => {
    const payload = {
      user: { id: "U1" },
      view: {
        private_metadata: JSON.stringify({
          channel: "C1", messageTs: "1.2", threadTs: "1.2", files: [],
        }),
        state: {
          values: {
            title: { title_input: { value: "Login broken" } },
            description: { description_input: { value: "500" } },
            severity: { severity_input: { selected_option: { value: "high" } } },
          },
        },
      },
    }
    expect(parseTicketSubmission(payload)).toEqual({
      slackUserId: "U1",
      title: "Login broken",
      description: "500",
      severityLabel: "high",
      meta: { channel: "C1", messageTs: "1.2", threadTs: "1.2", files: [] },
    })
  })
})
