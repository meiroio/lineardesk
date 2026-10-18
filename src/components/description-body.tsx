import { RiImageLine } from "@remixicon/react"
import type { ReactNode } from "react"
import { useState } from "react"

import { markdownImages } from "@/lib/markdown-images"

function AssetImage({
  url,
  alt,
  requestId,
  commentId,
}: {
  url: string
  alt: string
  requestId?: string
  commentId?: string
}) {
  const [failed, setFailed] = useState(false)
  const displayUrl =
    requestId && url.startsWith("https://uploads.linear.app/")
      ? `/api/requests/${encodeURIComponent(requestId)}/assets?url=${encodeURIComponent(url)}${commentId ? `&commentId=${encodeURIComponent(commentId)}` : ""}`
      : url

  if (failed) {
    return (
      <a
        href={displayUrl}
        target="_blank"
        rel="noreferrer"
        className="inline-flex w-fit items-center gap-1 text-sm font-medium hover:underline"
      >
        <RiImageLine className="size-4 text-muted-foreground" aria-hidden />
        {alt}
      </a>
    )
  }

  return (
    <a
      href={displayUrl}
      target="_blank"
      rel="noreferrer"
      className="block w-fit"
    >
      <img
        src={displayUrl}
        alt={alt}
        loading={commentId ? "lazy" : undefined}
        className="max-h-80 rounded-lg border"
        onError={() => setFailed(true)}
      />
    </a>
  )
}

export function DescriptionBody({
  text,
  requestId,
  commentId,
}: {
  text: string
  requestId?: string
  commentId?: string
}) {
  const parts: ReactNode[] = []
  let lastIndex = 0
  let key = 0

  for (const image of markdownImages(text)) {
    if (image.start > lastIndex) {
      parts.push(
        <span key={key++} className="whitespace-pre-wrap">
          {text.slice(lastIndex, image.start)}
        </span>
      )
    }
    parts.push(
      <AssetImage
        key={key++}
        url={image.url}
        alt={image.alt || "screenshot"}
        requestId={requestId}
        commentId={commentId}
      />
    )
    lastIndex = image.end
  }
  if (lastIndex < text.length) {
    parts.push(
      <span key={key++} className="whitespace-pre-wrap">
        {text.slice(lastIndex)}
      </span>
    )
  }

  return (
    <div className="flex flex-col gap-3 text-sm leading-6 wrap-anywhere text-muted-foreground">
      {parts}
    </div>
  )
}
