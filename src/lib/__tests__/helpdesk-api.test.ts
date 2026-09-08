import { afterEach, describe, expect, it, vi } from "vitest"

import { fetchRequests, formatCommentCount } from "../helpdesk-api"

afterEach(() => vi.unstubAllGlobals())

describe("fetchRequests", () => {
  it("sends page and filters to the API and preserves its result metadata", async () => {
    const result = { requests: [], total: 23, page: 2, pageSize: 10 }
    const fetch = vi.fn(async () => Response.json(result))
    vi.stubGlobal("fetch", fetch)

    expect(
      await fetchRequests({
        page: 2,
        pageSize: 10,
        status: "done",
        severity: [1, 2],
      })
    ).toEqual(result)
    expect(fetch).toHaveBeenLastCalledWith(
      "/api/requests?page=2&pageSize=10&status=done&severity=1%2C2",
      { credentials: "include" }
    )

    await fetchRequests({ page: 0, pageSize: 10, status: "all", severity: [] })
    expect(fetch).toHaveBeenLastCalledWith(
      "/api/requests?page=0&pageSize=10&status=all",
      { credentials: "include" }
    )
  })
})

describe("formatCommentCount", () => {
  it("formats singular and plural comment counts", () => {
    expect(formatCommentCount(0)).toBe("0 comments")
    expect(formatCommentCount(1)).toBe("1 comment")
    expect(formatCommentCount(2)).toBe("2 comments")
  })
})
