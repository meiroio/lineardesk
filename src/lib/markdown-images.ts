const IMAGE_RE = /!\[([^\]]*)\]\(([^)]+)\)/g

export type MarkdownImage = {
  alt: string
  url: string
  start: number
  end: number
}

export function markdownImages(text: string): MarkdownImage[] {
  return Array.from(text.matchAll(IMAGE_RE), (match) => ({
    alt: match[1],
    url: match[2],
    start: match.index,
    end: match.index + match[0].length,
  }))
}
