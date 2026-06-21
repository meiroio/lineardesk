import { Elysia } from "elysia"

import { UploadImageResponseModel } from "./contracts"
import type { ApiDependencyResolver } from "./dependencies"
import { json, requireAuthorizedSession } from "./http"

const ALLOWED_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024

function sanitizeFilename(value: string | null): string {
  if (!value) return "image"
  let decoded = value
  try {
    decoded = decodeURIComponent(value)
  } catch {
    decoded = value
  }
  const base = decoded.split(/[\\/]/).pop() ?? "image"
  const cleaned = base.replace(/[^\w.-]+/g, "_").slice(0, 100)
  return cleaned || "image"
}

export function createUploadsApi(getDependencies: ApiDependencyResolver) {
  return new Elysia({ name: "api.uploads" }).post(
    "/uploads",
    async ({ request }) => {
      const deps = getDependencies()
      const session = await requireAuthorizedSession(deps, request.headers)
      if (session instanceof Response) return session

      const contentType = (request.headers.get("content-type") ?? "")
        .split(";")[0]
        .trim()
        .toLowerCase()
      if (!ALLOWED_IMAGE_TYPES.includes(contentType)) {
        return json(
          { error: "validation_error", issues: ["Unsupported image type"] },
          400
        )
      }

      const bytes = new Uint8Array(await request.arrayBuffer())
      if (bytes.byteLength === 0) {
        return json({ error: "validation_error", issues: ["Empty file"] }, 400)
      }
      if (bytes.byteLength > MAX_UPLOAD_BYTES) {
        return json({ error: "file_too_large" }, 413)
      }

      const filename = sanitizeFilename(request.headers.get("x-filename"))
      const asset = await deps.linear.uploadAsset({
        contentType,
        filename,
        bytes,
      })

      return json({ assetUrl: asset.assetUrl, filename }, 201)
    },
    {
      response: UploadImageResponseModel,
    }
  )
}
