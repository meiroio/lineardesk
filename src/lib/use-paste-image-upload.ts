import type { ClipboardEvent, Dispatch, SetStateAction } from "react"
import { useCallback, useRef, useState } from "react"

import { ApiError } from "@/lib/helpdesk-api"
import type { UploadImageResponse } from "@/lib/helpdesk-api"

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"]
export const IMAGE_ACCEPT = IMAGE_TYPES.join(",")

type UploadImage = (file: File) => Promise<UploadImageResponse>

export function usePasteImageUpload(
  uploadImage: UploadImage,
  setValue: Dispatch<SetStateAction<string>>,
  onError: (message: string | null) => void
) {
  const [pending, setPending] = useState(0)
  const counter = useRef(0)

  const uploadFiles = useCallback(
    (
      fileList: FileList | File[],
      selection?: { start: number; end: number }
    ) => {
      const supplied = Array.from(fileList)
      const files = supplied.filter((file) => IMAGE_TYPES.includes(file.type))
      if (files.length === 0) {
        if (supplied.length > 0) {
          onError("Choose a PNG, JPEG, GIF, or WebP image.")
        }
        return false
      }

      onError(null)

      const uploads = files.map((file) => {
        const id = (counter.current += 1)
        return { file, token: `![uploading ${file.name} #${id}…]()` }
      })

      setValue((previous) => {
        const start = selection?.start ?? previous.length
        const end = selection?.end ?? previous.length
        const prefix = previous.slice(0, start)
        const separator =
          selection || !prefix || prefix.endsWith("\n") ? "" : "\n\n"

        return (
          prefix +
          separator +
          uploads.map((upload) => upload.token).join("\n") +
          previous.slice(end)
        )
      })

      for (const { file, token } of uploads) {
        setPending((count) => count + 1)

        void uploadImage(file)
          .then(({ assetUrl, filename }) => {
            setValue((prev) =>
              prev.replace(token, `![${filename}](${assetUrl})`)
            )
          })
          .catch((error: unknown) => {
            setValue((prev) => prev.replace(token, ""))
            onError(
              error instanceof ApiError && error.status === 413
                ? `${file.name} is larger than the 20 MB limit.`
                : `Could not upload ${file.name}. Try again.`
            )
          })
          .finally(() => setPending((count) => count - 1))
      }

      return true
    },
    [onError, setValue, uploadImage]
  )

  const onPaste = useCallback(
    (event: ClipboardEvent<HTMLTextAreaElement>) => {
      if (
        uploadFiles(event.clipboardData.files, {
          start: event.currentTarget.selectionStart,
          end: event.currentTarget.selectionEnd,
        })
      ) {
        event.preventDefault()
      }
    },
    [uploadFiles]
  )

  return { onPaste, pending, uploadFiles }
}
