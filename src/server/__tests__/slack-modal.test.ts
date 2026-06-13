import { describe, expect, it } from "vitest"

import {
  buildLoadingModal,
  buildTicketModal,
  parseTicketSubmission,
} from "../slack/modal"

const meta = { channel: "C1", messageTs: "1.1", threadTs: "1.1", files: [] }

describe("buildLoadingModal", () => {
  it("is an input-less modal with a drafting message and no submit", () => {
    const view = buildLoadingModal()
    expect(view.type).toBe("modal")
    expect("submit" in view).toBe(false)
    expect(JSON.stringify(view.blocks)).toContain("Drafting")
    expect(JSON.stringify(view.blocks)).not.toContain('"type":"input"')
  })
})

describe("buildTicketModal", () => {
  it("builds the 5-field form and pre-fills from draft", () => {
    const view = buildTicketModal({
      prefill: {
        title: "CSV export 500s",
        expectedBehaviour: "works",
        currentBehaviour: "500",
        stepsToReproduce: "click export",
      },
      privateMetadata: meta,
    })
    expect(view.callback_id).toBe("slack_ticket_submit")
    const ids = view.blocks
      .map((b: { block_id?: string }) => b.block_id)
      .filter(Boolean)
    expect(ids).toEqual([
      "title",
      "expectedBehaviour",
      "currentBehaviour",
      "stepsToReproduce",
      "severity",
    ])
    expect(JSON.stringify(view.blocks)).toContain("click export")
    expect(JSON.parse(view.private_metadata).channel).toBe("C1")
  })
})

describe("parseTicketSubmission", () => {
  it("extracts the five fields + meta", () => {
    const payload = {
      user: { id: "U1" },
      view: {
        private_metadata: JSON.stringify(meta),
        state: {
          values: {
            title: { title_input: { value: "T" } },
            expectedBehaviour: { expectedBehaviour_input: { value: "E" } },
            currentBehaviour: { currentBehaviour_input: { value: "C" } },
            stepsToReproduce: { stepsToReproduce_input: { value: "S" } },
            severity: { severity_input: { selected_option: { value: "high" } } },
          },
        },
      },
    }
    expect(parseTicketSubmission(payload)).toEqual({
      slackUserId: "U1",
      title: "T",
      expectedBehaviour: "E",
      currentBehaviour: "C",
      stepsToReproduce: "S",
      severityLabel: "high",
      meta,
    })
  })
})
