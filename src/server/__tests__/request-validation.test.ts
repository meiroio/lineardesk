import { describe, expect, it } from "vitest"

import {
  parseCreateCommentInput,
  parseCreateRequestInput,
  parseUpdateRequestInput,
  RequestValidationError,
} from "../request-validation"

describe("parseCreateRequestInput", () => {
  const valid = {
    title: "  Login is broken  ",
    expectedBehaviour: "  Google sign-in succeeds.  ",
    currentBehaviour: "  Sign-in fails after redirect.  ",
    stepsToReproduce: "  1. Click sign in 2. Pick account  ",
    severity: "High",
  }

  it("trims, merges sections, and maps severity to a priority integer", () => {
    expect(parseCreateRequestInput(valid)).toEqual({
      title: "Login is broken",
      description:
        "Expected behaviour\nGoogle sign-in succeeds.\n\n" +
        "Current behaviour\nSign-in fails after redirect.\n\n" +
        "Steps to reproduce\n1. Click sign in 2. Pick account",
      severity: 2,
    })
  })

  it("rejects missing section fields", () => {
    expect(() =>
      parseCreateRequestInput({ ...valid, currentBehaviour: "   " })
    ).toThrow(RequestValidationError)
  })

  it("rejects an unknown severity", () => {
    expect(() =>
      parseCreateRequestInput({ ...valid, severity: "blocker" })
    ).toThrow(RequestValidationError)
  })

  it("rejects fields beyond the public API limits", () => {
    expect(() =>
      parseCreateRequestInput({ ...valid, title: "x".repeat(161) })
    ).toThrow(RequestValidationError)

    expect(() =>
      parseCreateRequestInput({ ...valid, expectedBehaviour: "x".repeat(5001) })
    ).toThrow(RequestValidationError)
  })

  it("exposes per-field errors keyed by field name", () => {
    try {
      parseCreateRequestInput({
        title: "x",
        expectedBehaviour: "",
        currentBehaviour: "ok",
        stepsToReproduce: "ok",
        severity: "high",
      })
      throw new Error("should have thrown")
    } catch (error) {
      expect(error).toBeInstanceOf(RequestValidationError)
      const fields = (error as RequestValidationError).fields
      expect(Object.keys(fields)).toContain("title")
      expect(Object.keys(fields)).toContain("expectedBehaviour")
      expect(fields.currentBehaviour).toBeUndefined()
    }
  })
})

describe("parseUpdateRequestInput", () => {
  it("returns title, description (verbatim), severity", () => {
    expect(
      parseUpdateRequestInput({
        title: "Login broken",
        description: "Expected\n\nCurrent\n\nSteps",
        severity: "high",
      })
    ).toEqual({
      title: "Login broken",
      description: "Expected\n\nCurrent\n\nSteps",
      severity: 2,
    })
  })

  it("flags bad fields with a per-field map", () => {
    try {
      parseUpdateRequestInput({ title: "x", description: "", severity: "" })
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

describe("parseCreateCommentInput", () => {
  it("trims valid comment body input", () => {
    expect(
      parseCreateCommentInput({ body: "  Is it still broken?  " })
    ).toEqual({
      body: "Is it still broken?",
    })
  })

  it("rejects missing or empty comment body input", () => {
    expect(() => parseCreateCommentInput({ body: "" })).toThrow(
      RequestValidationError
    )
    expect(() => parseCreateCommentInput({})).toThrow(RequestValidationError)
  })
})
