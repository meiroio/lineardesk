import { describe, expect, it } from "vitest"

import { buildTranscript, parseTicketDraft } from "../ai/gemini"

describe("buildTranscript", () => {
  it("renders messages as authored lines, skipping empties", () => {
    expect(
      buildTranscript([
        { user: "U1", text: "the export button 500s" },
        { user: null, text: "" },
        { user: "U2", text: "only on the CSV export" },
      ])
    ).toBe("U1: the export button 500s\nU2: only on the CSV export")
  })
})

describe("parseTicketDraft", () => {
  it("parses a full JSON draft", () => {
    const draft = parseTicketDraft(
      JSON.stringify({
        title: "CSV export 500s",
        expectedBehaviour: "export works",
        currentBehaviour: "500 error",
        stepsToReproduce: "click export",
      })
    )
    expect(draft).toEqual({
      title: "CSV export 500s",
      expectedBehaviour: "export works",
      currentBehaviour: "500 error",
      stepsToReproduce: "click export",
    })
  })

  it("coerces missing fields to empty strings", () => {
    expect(parseTicketDraft(JSON.stringify({ title: "x" }))).toEqual({
      title: "x",
      expectedBehaviour: "",
      currentBehaviour: "",
      stepsToReproduce: "",
    })
  })

  it("throws on non-JSON", () => {
    expect(() => parseTicketDraft("not json")).toThrow()
  })
})
