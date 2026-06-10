import { describe, expect, it } from "vitest"

import { authClientOptions } from "../auth-client"

describe("auth client", () => {
  it("uses Better Auth basePath instead of an invalid relative baseURL", async () => {
    await expect(import("../auth-client")).resolves.toHaveProperty("authClient")
    expect(authClientOptions).toEqual({ basePath: "/api/auth" })
    expect("baseURL" in authClientOptions).toBe(false)
  })
})
