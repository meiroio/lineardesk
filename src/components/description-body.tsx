import { RiImageLine } from "@remixicon/react"
import type { ReactNode } from "react"
import { useState } from "react"

const IMAGE_RE = /!\[([^\]]*)\]\(([^)]+)\)/g

function AssetImage({ url, alt }: { url: string; alt: string }) {
  const [failed, setFailed] = useState(false)

  if (failed) {
    return (
      <a
        href={url}
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
    <a href={url} target="_blank" rel="noreferrer" className="block w-fit">
      <img
        src={url}
        alt={alt}
        className="max-h-80 rounded-lg border"
        onError={() => setFailed(true)}
      />
    </a>
  )
}

export function DescriptionBody({ text }: { text: string }) {
  const parts: ReactNode[] = []
  let lastIndex = 0
  let key = 0
  let match: RegExpExecArray | null

  IMAGE_RE.lastIndex = 0
  while ((match = IMAGE_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(
        <span key={key++} className="whitespace-pre-wrap">
          {text.slice(lastIndex, match.index)}
        </span>
      )
    }
    parts.push(
      <AssetImage key={key++} url={match[2]} alt={match[1] || "screenshot"} />
    )
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < text.length) {
    parts.push(
      <span key={key++} className="whitespace-pre-wrap">
        {text.slice(lastIndex)}
      </span>
    )
  }

  return (
    <div className="flex flex-col gap-3 text-sm leading-6 text-muted-foreground">
      {parts}
    </div>
  )
}
