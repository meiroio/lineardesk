import { describe, expect, it } from "vitest"

import {
  parseCreateCommentInput,
  parseCreateRequestInput,
  RequestValidationError,
} from "../request-validation"

describe("parseCreateRequestInput", () => {
  it("trims valid input", () => {
    expect(
      parseCreateRequestInput({
        title: "  Login is broken  ",
        description: "  I cannot sign in with Google from Chrome.  ",
      })
    ).toEqual({
      title: "Login is broken",
      description: "I cannot sign in with Google from Chrome.",
    })
  })

  it("rejects too-short or missing fields", () => {
    expect(() =>
      parseCreateRequestInput({ title: "Hi", description: "short" })
    ).toThrow(RequestValidationError)
  })

  it("rejects fields beyond the public API limits", () => {
    expect(() =>
      parseCreateRequestInput({
        title: "x".repeat(161),
        description: "Valid description text",
      })
    ).toThrow(RequestValidationError)

    expect(() =>
      parseCreateRequestInput({
        title: "Valid title",
        description: "x".repeat(5001),
      })
    ).toThrow(RequestValidationError)
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
