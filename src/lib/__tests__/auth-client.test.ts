import { describe, expect, it } from "vitest"

import { authClientOptions } from "../auth-client"

describe("auth client", () => {
  it("uses Better Auth basePath and client plugins", async () => {
    await expect(import("../auth-client")).resolves.toHaveProperty("authClient")
    const options = authClientOptions as {
      basePath?: string
      baseURL?: unknown
      plugins?: unknown[]
    }

    expect(options.basePath).toBe("/api/auth")
    expect("baseURL" in options).toBe(false)
    expect(options.plugins).toHaveLength(2)
  })
})
