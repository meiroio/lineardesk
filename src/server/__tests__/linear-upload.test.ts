import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { LinearClient } from "@linear/sdk"

import { createLinearGateway } from "../linear"

vi.mock("@linear/sdk", () => ({
  LinearClient: vi.fn(),
}))

const config = {
  apiKey: "lin_key",
  teamId: "team-id",
  teamKey: "BAS",
  initialStateName: "Triage",
  labelName: "Bug",
  webhookSecret: "secret",
}

const fileUpload = vi.fn()
const originalFetch = global.fetch

beforeEach(() => {
  fileUpload.mockReset()
  vi.mocked(LinearClient).mockImplementation(function () {
    return { fileUpload } as unknown as LinearClient
  })
})

afterEach(() => {
  global.fetch = originalFetch
  vi.restoreAllMocks()
})

describe("uploadAsset", () => {
  it("uploads bytes to the pre-signed URL and returns the asset URL", async () => {
    fileUpload.mockResolvedValue({
      uploadFile: {
        uploadUrl: "https://upload.example/put",
        assetUrl: "https://assets.example/abc.png",
        headers: [{ key: "x-amz-acl", value: "private" }],
      },
    })
    const fetchMock = vi.fn(
      async (_url: RequestInfo | URL, _init?: RequestInit) =>
        new Response(null, { status: 200 })
    )
    global.fetch = fetchMock

    const gateway = createLinearGateway(config)
    const result = await gateway.uploadAsset({
      contentType: "image/png",
      filename: "shot.png",
      bytes: new Uint8Array([1, 2, 3]),
    })

    expect(result).toEqual({ assetUrl: "https://assets.example/abc.png" })
    expect(fileUpload).toHaveBeenCalledWith("image/png", "shot.png", 3)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("https://upload.example/put")
    expect(init?.method).toBe("PUT")
    const headers = new Headers(init?.headers)
    expect(headers.get("content-type")).toBe("image/png")
    expect(headers.get("x-amz-acl")).toBe("private")
  })

  it("throws when Linear cannot prepare the upload", async () => {
    fileUpload.mockResolvedValue({ uploadFile: null })

    const gateway = createLinearGateway(config)
    await expect(
      gateway.uploadAsset({
        contentType: "image/png",
        filename: "x.png",
        bytes: new Uint8Array([1]),
      })
    ).rejects.toThrow("Linear file upload could not be prepared")
  })

  it("throws when the upload PUT fails", async () => {
    fileUpload.mockResolvedValue({
      uploadFile: {
        uploadUrl: "https://upload.example/put",
        assetUrl: "https://assets.example/abc.png",
        headers: [],
      },
    })
    global.fetch = vi.fn(async () => new Response(null, { status: 500 }))

    const gateway = createLinearGateway(config)
    await expect(
      gateway.uploadAsset({
        contentType: "image/png",
        filename: "x.png",
        bytes: new Uint8Array([1]),
      })
    ).rejects.toThrow("Linear asset upload failed with status 500")
  })
})
