import { RiUpload2Line } from "@remixicon/react"
import { useRef, useState } from "react"

import { DescriptionBody } from "@/components/description-body"
import { Button } from "@/components/ui/button"
import { IMAGE_ACCEPT } from "@/lib/use-paste-image-upload"
import type { usePasteImageUpload } from "@/lib/use-paste-image-upload"
import { cn } from "@/lib/utils"

type ImageUpload = Pick<
  ReturnType<typeof usePasteImageUpload>,
  "pending" | "uploadFiles"
>

export function ImageDropzone({
  id,
  imageUpload,
  previewText,
  onClear,
}: {
  id: string
  imageUpload: ImageUpload
  previewText?: string
  onClear?: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  return (
    <fieldset className="grid gap-2">
      <legend className="text-sm font-medium">Attachments</legend>
      <div
        className={cn(
          "flex min-h-24 flex-wrap items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-muted/30 px-4 py-4 text-center transition-colors",
          dragging && "border-primary bg-primary/10"
        )}
        onDragEnter={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragOver={(event) => {
          event.preventDefault()
          event.dataTransfer.dropEffect = "copy"
        }}
        onDragLeave={(event) => {
          if (
            !event.currentTarget.contains(event.relatedTarget as Node | null)
          ) {
            setDragging(false)
          }
        }}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          imageUpload.uploadFiles(event.dataTransfer.files)
        }}
      >
        <input
          ref={inputRef}
          id={id}
          type="file"
          accept={IMAGE_ACCEPT}
          multiple
          tabIndex={-1}
          className="sr-only"
          aria-label="Choose attachment images"
          onChange={(event) => {
            if (event.currentTarget.files) {
              imageUpload.uploadFiles(event.currentTarget.files)
            }
            event.currentTarget.value = ""
          }}
        />
        <span
          className="text-sm text-muted-foreground"
          role="status"
          aria-live="polite"
        >
          {imageUpload.pending > 0
            ? `Uploading ${imageUpload.pending} image${imageUpload.pending === 1 ? "" : "s"}…`
            : "Drop screenshots here or"}
        </span>
        <Button
          type="button"
          variant="outline"
          onClick={() => inputRef.current?.click()}
        >
          <RiUpload2Line aria-hidden />
          Upload images
        </Button>
        <span className="w-full text-xs text-muted-foreground">
          PNG, JPEG, GIF, or WebP · up to 20 MB each
        </span>
      </div>

      {previewText && imageUpload.pending === 0 ? (
        <div className="grid gap-3 rounded-xl border border-border p-3">
          <DescriptionBody text={previewText} />
          {onClear ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="justify-self-end"
              onClick={onClear}
            >
              Remove attachments
            </Button>
          ) : null}
        </div>
      ) : null}
    </fieldset>
  )
}
