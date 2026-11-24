import { RiUpload2Line } from "@remixicon/react"
import { Button } from "@ui-sdk/react/button"
import { FieldLegend, FieldSet } from "@ui-sdk/react/field"
import {
  FileInput,
  FileInputDropzone,
  FileInputTrigger,
} from "@ui-sdk/react/file-input"

import { DescriptionBody } from "@/components/description-body"
import { IMAGE_ACCEPT } from "@/lib/use-paste-image-upload"
import type { usePasteImageUpload } from "@/lib/use-paste-image-upload"

type ImageUpload = Pick<
  ReturnType<typeof usePasteImageUpload>,
  "pending" | "uploadFiles"
>

const NO_FILES: File[] = []

export function ImageDropzone({
  imageUpload,
  previewText,
  onClear,
  label = "Attachments",
  uploadLabel = "Upload images",
}: {
  imageUpload: ImageUpload
  previewText?: string
  onClear?: () => void
  label?: string
  uploadLabel?: string
}) {
  return (
    <FieldSet className="grid gap-2">
      <FieldLegend className="text-sm font-medium">{label}</FieldLegend>
      {/* Files upload as soon as they arrive, so the input never holds any. */}
      <FileInput
        multiple
        accept={IMAGE_ACCEPT}
        value={NO_FILES}
        onValueChange={(_, details) => {
          if (details.added.length > 0) imageUpload.uploadFiles(details.added)
        }}
        onReject={(rejected) =>
          imageUpload.uploadFiles(rejected.map((rejection) => rejection.file))
        }
      >
        <FileInputDropzone className="flex min-h-24 flex-row flex-wrap items-center justify-center gap-2 rounded-xl border-border bg-muted/30 p-4 data-dragging:border-primary data-dragging:bg-primary/10">
          <span className="text-sm text-muted-foreground" aria-live="polite">
            {imageUpload.pending > 0
              ? `Uploading ${imageUpload.pending} image${imageUpload.pending === 1 ? "" : "s"}…`
              : "Drop screenshots here or"}
          </span>
          <FileInputTrigger className="mt-0">
            <RiUpload2Line aria-hidden />
            {uploadLabel}
          </FileInputTrigger>
          <span className="w-full text-xs text-muted-foreground">
            PNG, JPEG, GIF, or WebP · up to 20 MB each
          </span>
        </FileInputDropzone>
      </FileInput>

      {previewText && imageUpload.pending === 0 ? (
        <div className="grid gap-3 rounded-xl border border-border p-3">
          <DescriptionBody text={previewText} />
          {onClear ? (
            <Button
              data-variant="ghost"
              data-size="sm"
              className="justify-self-end"
              onClick={onClear}
            >
              Remove attachments
            </Button>
          ) : null}
        </div>
      ) : null}
    </FieldSet>
  )
}
