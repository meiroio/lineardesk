export class RequestValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(issues.join("; "))
    this.name = "RequestValidationError"
  }
}

export type CreateRequestInput = {
  title: string
  description: string
}

export type CreateCommentInput = {
  body: string
}

export function parseCreateRequestInput(input: unknown): CreateRequestInput {
  const issues: string[] = []
  const value = input && typeof input === "object" ? input : {}
  const title =
    "title" in value && typeof value.title === "string"
      ? value.title.trim()
      : ""
  const description =
    "description" in value && typeof value.description === "string"
      ? value.description.trim()
      : ""

  if (title.length < 3) issues.push("Title must be at least 3 characters")
  if (title.length > 160) issues.push("Title must be at most 160 characters")
  if (description.length < 10)
    issues.push("Description must be at least 10 characters")
  if (description.length > 5000)
    issues.push("Description must be at most 5000 characters")

  if (issues.length > 0) throw new RequestValidationError(issues)

  return { title, description }
}

export function parseCreateCommentInput(input: unknown): CreateCommentInput {
  const issues: string[] = []
  const value = input && typeof input === "object" ? input : {}
  const body =
    "body" in value && typeof value.body === "string" ? value.body.trim() : ""

  if (body.length < 1) issues.push("Comment must not be empty")
  if (body.length > 5000) issues.push("Comment must be at most 5000 characters")

  if (issues.length > 0) throw new RequestValidationError(issues)

  return { body }
}
