import { describe, expect, it } from "vitest"

import {
  parseSlackTicketInput,
  RequestValidationError,
  severityFromLabel,
} from "../request-validation"

describe("severityFromLabel", () => {
  it("maps labels to Linear priorities", () => {
    expect(severityFromLabel("urgent")).toBe(1)
    expect(severityFromLabel("low")).toBe(4)
    expect(severityFromLabel("nope")).toBeNull()
  })

  it("is case-insensitive and trims", () => {
    expect(severityFromLabel("  URGENT  ")).toBe(1)
    expect(severityFromLabel("Medium")).toBe(3)
  })
})

describe("parseSlackTicketInput", () => {
  it("returns title, description, severity", () => {
    expect(
      parseSlackTicketInput({
        title: "Login broken",
        description: "It 500s on submit",
        severity: "high",
      })
    ).toEqual({
      title: "Login broken",
      description: "It 500s on submit",
      severity: 2,
    })
  })

  it("rejects a short title and bad severity with field-keyed issues", () => {
    try {
      parseSlackTicketInput({ title: "x", description: "", severity: "" })
      throw new Error("should have thrown")
    } catch (error) {
      expect(error).toBeInstanceOf(RequestValidationError)
      const fields = (error as RequestValidationError).fields
      expect(Object.keys(fields).sort()).toEqual(
        ["description", "severity", "title"].sort()
      )
    }
  })
})
