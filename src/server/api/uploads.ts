import { Elysia } from "elysia"

import {
  ErrorResponseModel,
  UploadImageResponseModel,
  ValidationErrorResponseModel,
} from "./contracts"
import type { ApiDependenciesPlugin } from "./dependencies"
import { requireAuthorizedSession } from "./http"

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

export function createUploadsApi(apiDependencies: ApiDependenciesPlugin) {
  return new Elysia({ name: "api.uploads" }).use(apiDependencies).post(
    "/uploads",
    async ({ request, resolveApiDependencies, status }) => {
      const deps = resolveApiDependencies()
      const authorization = await requireAuthorizedSession(
        deps,
        request.headers
      )
      if (!authorization.ok) {
        return status(authorization.status, authorization.body)
      }

      const contentType = (request.headers.get("content-type") ?? "")
        .split(";")[0]
        .trim()
        .toLowerCase()
      if (!ALLOWED_IMAGE_TYPES.includes(contentType)) {
        return status(400, {
          error: "validation_error",
          issues: ["Unsupported image type"],
        })
      }

      const bytes = new Uint8Array(await request.arrayBuffer())
      if (bytes.byteLength === 0) {
        return status(400, {
          error: "validation_error",
          issues: ["Empty file"],
        })
      }
      if (bytes.byteLength > MAX_UPLOAD_BYTES) {
        return status(413, { error: "file_too_large" })
      }

      const filename = sanitizeFilename(request.headers.get("x-filename"))
      const asset = await deps.linear.uploadAsset({
        contentType,
        filename,
        bytes,
      })

      return status(201, { assetUrl: asset.assetUrl, filename })
    },
    {
      response: {
        201: UploadImageResponseModel,
        400: ValidationErrorResponseModel,
        401: ErrorResponseModel,
        403: ErrorResponseModel,
        409: ErrorResponseModel,
        413: ErrorResponseModel,
      },
    }
  )
}
