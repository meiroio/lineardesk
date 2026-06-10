import { describe, expect, it } from "vitest"

import { formatCommentCount } from "../helpdesk-api"

describe("formatCommentCount", () => {
  it("formats singular and plural comment counts", () => {
    expect(formatCommentCount(0)).toBe("0 comments")
    expect(formatCommentCount(1)).toBe("1 comment")
    expect(formatCommentCount(2)).toBe("2 comments")
  })
})
