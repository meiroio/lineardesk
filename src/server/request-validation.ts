export class RequestValidationError extends Error {
  constructor(
    readonly issues: string[],
    readonly fields: Record<string, string> = {}
  ) {
    super(issues.join("; "))
    this.name = "RequestValidationError"
  }
}

export type CreateRequestInput = {
  title: string
  description: string
  severity: number
}

export type CreateCommentInput = {
  body: string
}

const SEVERITY_PRIORITY: Record<string, number> = {
  urgent: 1,
  high: 2,
  medium: 3,
  low: 4,
}

export function mergeBugReportSections(input: {
  expectedBehaviour: string
  currentBehaviour: string
  stepsToReproduce: string
}): string {
  return [
    `Expected behaviour\n${input.expectedBehaviour}`,
    `Current behaviour\n${input.currentBehaviour}`,
    `Steps to reproduce\n${input.stepsToReproduce}`,
  ].join("\n\n")
}

export function parseCreateRequestInput(input: unknown): CreateRequestInput {
  const issues: string[] = []
  const fields: Record<string, string> = {}
  const value = input && typeof input === "object" ? input : {}

  const title =
    "title" in value && typeof value.title === "string"
      ? value.title.trim()
      : ""
  const expectedBehaviour =
    "expectedBehaviour" in value && typeof value.expectedBehaviour === "string"
      ? value.expectedBehaviour.trim()
      : ""
  const currentBehaviour =
    "currentBehaviour" in value && typeof value.currentBehaviour === "string"
      ? value.currentBehaviour.trim()
      : ""
  const stepsToReproduce =
    "stepsToReproduce" in value && typeof value.stepsToReproduce === "string"
      ? value.stepsToReproduce.trim()
      : ""
  const severityLabel =
    "severity" in value && typeof value.severity === "string"
      ? value.severity.trim().toLowerCase()
      : ""

  if (title.length < 3) {
    const msg = "Title must be at least 3 characters"
    issues.push(msg)
    fields.title = msg
  }
  if (title.length > 160) {
    const msg = "Title must be at most 160 characters"
    issues.push(msg)
    fields.title = msg
  }

  const sections: ReadonlyArray<readonly [string, string, string]> = [
    ["expectedBehaviour", "Expected behaviour", expectedBehaviour],
    ["currentBehaviour", "Current behaviour", currentBehaviour],
    ["stepsToReproduce", "Steps to reproduce", stepsToReproduce],
  ]
  for (const [key, label, field] of sections) {
    if (field.length < 1) {
      const msg = `${label} is required`
      issues.push(msg)
      fields[key] = msg
    }
    if (field.length > 5000) {
      const msg = `${label} must be at most 5000 characters`
      issues.push(msg)
      fields[key] = msg
    }
  }

  const severity = SEVERITY_PRIORITY[severityLabel]
  if (!severity) {
    const msg = "Severity must be one of: urgent, high, medium, low"
    issues.push(msg)
    fields.severity = msg
  }

  if (issues.length > 0) throw new RequestValidationError(issues, fields)

  return {
    title,
    description: mergeBugReportSections({
      expectedBehaviour,
      currentBehaviour,
      stepsToReproduce,
    }),
    severity,
  }
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
