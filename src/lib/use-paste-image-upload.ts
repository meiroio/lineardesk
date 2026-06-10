import type { ClipboardEvent, Dispatch, SetStateAction } from "react"
import { useCallback, useRef, useState } from "react"

import { ApiError, uploadImage } from "@/lib/helpdesk-api"

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"]

export function usePasteImageUpload(
  setValue: Dispatch<SetStateAction<string>>,
  onError: (message: string) => void
) {
  const [pending, setPending] = useState(0)
  const counter = useRef(0)

  const onPaste = useCallback(
    (event: ClipboardEvent<HTMLTextAreaElement>) => {
      const files = Array.from(event.clipboardData.files).filter((file) =>
        IMAGE_TYPES.includes(file.type)
      )
      if (files.length === 0) return

      event.preventDefault()
      const textarea = event.currentTarget
      // lib.dom types selectionStart/End as non-null for textarea, but guard
      // defensively in case the value is ever cleared.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      const start = textarea.selectionStart ?? textarea.value.length
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      const end = textarea.selectionEnd ?? start

      for (const file of files) {
        const id = (counter.current += 1)
        const token = `![uploading ${file.name} #${id}…]()`
        setValue((prev) => prev.slice(0, start) + token + prev.slice(end))
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
    },
    [setValue, onError]
  )

  return { onPaste, pending }
}
