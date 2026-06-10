export class RequestValidationError extends Error {
  constructor(readonly issues: string[]) {
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

  if (title.length < 3) issues.push("Title must be at least 3 characters")
  if (title.length > 160) issues.push("Title must be at most 160 characters")

  const sections: ReadonlyArray<readonly [string, string]> = [
    ["Expected behaviour", expectedBehaviour],
    ["Current behaviour", currentBehaviour],
    ["Steps to reproduce", stepsToReproduce],
  ]
  for (const [label, field] of sections) {
    if (field.length < 1) issues.push(`${label} is required`)
    if (field.length > 5000)
      issues.push(`${label} must be at most 5000 characters`)
  }

  const severity = SEVERITY_PRIORITY[severityLabel]
  if (!severity)
    issues.push("Severity must be one of: urgent, high, medium, low")

  if (issues.length > 0) throw new RequestValidationError(issues)

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
