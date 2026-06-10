# Bug Report Form Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add bug severity (Linear Priority), split the request form into three required sections merged into one Linear description, and support pasting images that upload to Linear.

**Architecture:** Server stays the same shape — the parse layer validates the new payload, maps a severity label to a Linear priority integer, and merges the three fields into one `description` string that flows through the existing Linear path unchanged. A new `severity` column persists the priority integer for badges. A new `POST /api/uploads` route streams image bytes through Linear's `fileUpload` and returns the asset URL; the client inserts the returned markdown ref into the focused textarea so images ride into Linear via the merged description. Persistence is merged-only — the three raw fields are not stored separately.

**Tech Stack:** TanStack Start, Elysia (`/api`), Drizzle/Postgres, `@linear/sdk`, Better Auth, React 19, Tailwind v4 + shadcn (base-maia), Vitest.

---

## Severity reference (used throughout)

Severity label → Linear priority integer: `urgent → 1`, `high → 2`, `medium → 3`, `low → 4`. The stored `severity` column value **is** this priority integer. Default in the form is `medium` (3).

Merge format (plain labels, blank-line separated):

```
Expected behaviour
<expected>

Current behaviour
<current>

Steps to reproduce
<repro>
```

---

## Task 1: Severity mapping, merge helper, and validation

**Files:**
- Modify: `src/server/request-validation.ts`
- Test: `src/server/__tests__/request-validation.test.ts`

- [ ] **Step 1: Update the failing tests for the new payload**

Replace the `describe("parseCreateRequestInput", ...)` block in `src/server/__tests__/request-validation.test.ts` with:

```ts
describe("parseCreateRequestInput", () => {
  const valid = {
    title: "  Login is broken  ",
    expectedBehaviour: "  Google sign-in succeeds.  ",
    currentBehaviour: "  Sign-in fails after redirect.  ",
    stepsToReproduce: "  1. Click sign in 2. Pick account  ",
    severity: "High",
  }

  it("trims, merges sections, and maps severity to a priority integer", () => {
    expect(parseCreateRequestInput(valid)).toEqual({
      title: "Login is broken",
      description:
        "Expected behaviour\nGoogle sign-in succeeds.\n\n" +
        "Current behaviour\nSign-in fails after redirect.\n\n" +
        "Steps to reproduce\n1. Click sign in 2. Pick account",
      severity: 2,
    })
  })

  it("rejects missing section fields", () => {
    expect(() =>
      parseCreateRequestInput({ ...valid, currentBehaviour: "   " })
    ).toThrow(RequestValidationError)
  })

  it("rejects an unknown severity", () => {
    expect(() =>
      parseCreateRequestInput({ ...valid, severity: "blocker" })
    ).toThrow(RequestValidationError)
  })

  it("rejects fields beyond the public API limits", () => {
    expect(() =>
      parseCreateRequestInput({ ...valid, title: "x".repeat(161) })
    ).toThrow(RequestValidationError)

    expect(() =>
      parseCreateRequestInput({ ...valid, expectedBehaviour: "x".repeat(5001) })
    ).toThrow(RequestValidationError)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bunx vitest run src/server/__tests__/request-validation.test.ts`
Expected: FAIL (current `parseCreateRequestInput` returns `{ title, description }`, no `severity`, no merge).

- [ ] **Step 3: Implement the new validation + helpers**

In `src/server/request-validation.ts`, replace the `CreateRequestInput` type and `parseCreateRequestInput` function (keep `RequestValidationError`, `CreateCommentInput`, and `parseCreateCommentInput` as-is) with:

```ts
export type CreateRequestInput = {
  title: string
  description: string
  severity: number
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bunx vitest run src/server/__tests__/request-validation.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/request-validation.ts src/server/__tests__/request-validation.test.ts
git commit -m "feat: validate split bug-report fields and severity"
```

---

## Task 2: Linear gateway — priority on issue + uploadAsset

**Files:**
- Modify: `src/server/types.ts`
- Modify: `src/server/linear.ts`
- Test: `src/server/__tests__/linear.test.ts`

- [ ] **Step 1: Add the failing priority test**

In `src/server/__tests__/linear.test.ts`, add these two tests inside the `describe("buildLinearIssueInput", ...)` block:

```ts
  it("sets the Linear priority when provided", () => {
    const input = buildLinearIssueInput({
      title: "Cannot export invoices",
      description: "The export button spins forever.",
      requesterEmail: "user@example.com",
      teamId: "team-id",
      stateId: "state-id",
      labelId: "label-id",
      priority: 2,
    })

    expect(input.priority).toBe(2)
  })

  it("omits priority when not provided", () => {
    const input = buildLinearIssueInput({
      title: "Question",
      description: "How do I invite a teammate?",
      requesterEmail: "user@example.com",
      teamId: "team-id",
      stateId: "state-id",
      labelId: null,
    })

    expect(input).not.toHaveProperty("priority")
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bunx vitest run src/server/__tests__/linear.test.ts`
Expected: FAIL (`buildLinearIssueInput` doesn't accept/emit `priority`).

- [ ] **Step 3: Add types in `src/server/types.ts`**

Add `priority?: number` to `CreateHelpdeskIssueInput`:

```ts
export type CreateHelpdeskIssueInput = {
  title: string
  description: string
  requesterEmail: string
  priority?: number
}
```

Add these two types (place them right after `CreateHelpdeskIssueInput`):

```ts
export type UploadAssetInput = {
  contentType: string
  filename: string
  bytes: Uint8Array
}

export type UploadAssetResult = {
  assetUrl: string
}
```

Add `uploadAsset` to the `LinearGateway` type (alongside the existing methods):

```ts
  uploadAsset: (input: UploadAssetInput) => Promise<UploadAssetResult>
```

- [ ] **Step 4: Implement in `src/server/linear.ts`**

Add `UploadAssetInput`, `UploadAssetResult` to the type import block at the top (the `import type { ... } from "./types"` list).

Update the `LinearIssueCreateInput` type to include priority:

```ts
type LinearIssueCreateInput = {
  title: string
  description: string
  teamId: string
  stateId: string
  labelIds?: string[]
  priority?: number
}
```

Update `buildLinearIssueInput` — add `priority?: number` to its parameter type and set it:

```ts
export function buildLinearIssueInput(input: {
  title: string
  description: string
  requesterEmail: string
  teamId: string
  stateId: string
  labelId: string | null
  priority?: number
}): LinearIssueCreateInput {
  const issueInput: LinearIssueCreateInput = {
    title: input.title,
    description: `Requester: ${input.requesterEmail}\n\n${input.description}`,
    teamId: input.teamId,
    stateId: input.stateId,
  }

  if (input.labelId) issueInput.labelIds = [input.labelId]
  if (typeof input.priority === "number") issueInput.priority = input.priority

  return issueInput
}
```

In `createHelpdeskIssue`, the `buildLinearIssueInput({ ...input, ... })` call already spreads `input`, which now carries `priority` from `CreateHelpdeskIssueInput` — no extra change needed there.

Add the `uploadAsset` method to the `LinearSdkGateway` class (place after `createIssueComment`):

```ts
  async uploadAsset(input: UploadAssetInput): Promise<UploadAssetResult> {
    const payload = await this.client.fileUpload(
      input.contentType,
      input.filename,
      input.bytes.byteLength
    )
    const uploadFile = payload.uploadFile
    if (!uploadFile) {
      throw new Error("Linear file upload could not be prepared")
    }

    const headers = new Headers({ "content-type": input.contentType })
    for (const header of uploadFile.headers) {
      headers.set(header.key, header.value)
    }

    const response = await fetch(uploadFile.uploadUrl, {
      method: "PUT",
      headers,
      body: input.bytes,
    })
    if (!response.ok) {
      throw new Error(
        `Linear asset upload failed with status ${response.status}`
      )
    }

    return { assetUrl: uploadFile.assetUrl }
  }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bunx vitest run src/server/__tests__/linear.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/types.ts src/server/linear.ts src/server/__tests__/linear.test.ts
git commit -m "feat: set Linear priority and add asset upload gateway"
```

---

## Task 3: Persist severity and wire it through the create route

This task changes the `RequestRecord`/`CreateRequestRecordInput` types, the schema, the repository, and the `POST /requests` handler together so the project typechecks and tests pass at the end of the task (the new required `severity` field obligates the handler, so they must land together).

**Files:**
- Modify: `src/server/__tests__/app.test.ts`
- Modify: `src/server/db/schema.ts`
- Modify: `src/server/types.ts`
- Modify: `src/server/repository.ts`
- Modify: `src/server/app.ts`
- Create: `drizzle/0002_*.sql` (generated)

- [ ] **Step 1: Update the app tests for the new contract (red)**

In `src/server/__tests__/app.test.ts`:

(a) In `makeRecord`, add `severity` after `linearStateType`:

```ts
    linearStateType: "triage",
    severity: 3,
```

(b) Every inline `linear` object passed to `createApiApp` must include `uploadAsset` (the `LinearGateway` type now requires it). Add `uploadAsset: vi.fn(),` to each of the six `linear: { ... }` literals in this file (in: "mounts the Better Auth handler", "creates a Linear issue", "rejects authenticated users outside the allow-listed domains", "does not process the same Linear webhook event twice", "returns Linear comments with a request detail", and "creates requester replies as Linear comments").

(c) Replace the request body and assertions of the "creates a Linear issue and stores a helpdesk request" test:

```ts
    const response = await app.fetch(
      new Request("http://localhost/api/requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: " Cannot sign in ",
          expectedBehaviour: " Google sign-in succeeds. ",
          currentBehaviour: " Google sign-in fails after redirect. ",
          stepsToReproduce: " 1. Click sign in 2. Pick account ",
          severity: "high",
        }),
      })
    )

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({
      request: {
        id: "request-id",
        linearIdentifier: "BAS-123",
      },
    })
    expect(linear.createHelpdeskIssue).toHaveBeenCalledWith({
      title: "Cannot sign in",
      description:
        "Expected behaviour\nGoogle sign-in succeeds.\n\n" +
        "Current behaviour\nGoogle sign-in fails after redirect.\n\n" +
        "Steps to reproduce\n1. Click sign in 2. Pick account",
      requesterEmail: "person@example.com",
      priority: 2,
    })
    expect(repo.createRequest).toHaveBeenCalled()
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bunx vitest run src/server/__tests__/app.test.ts`
Expected: FAIL (TypeScript/runtime: handler still sends old shape; `severity` missing on the record type).

- [ ] **Step 3: Add the schema column**

In `src/server/db/schema.ts`, add `integer` to the `drizzle-orm/pg-core` import:

```ts
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core"
```

In the `helpdeskRequests` table, add the `severity` column immediately after `linearStateType`:

```ts
    linearStateType: text("linear_state_type").notNull(),
    severity: integer("severity"),
```

- [ ] **Step 4: Add severity to the types**

In `src/server/types.ts`, add `severity: number | null` to `RequestRecord` (after `linearStateType`):

```ts
  linearStateType: string
  severity: number | null
```

Add `severity: number` to `CreateRequestRecordInput`:

```ts
export type CreateRequestRecordInput = {
  requesterUserId: string
  requesterEmail: string
  title: string
  description: string
  severity: number
  linearIssue: LinearIssueSnapshot
  linearTeamId: string
}
```

- [ ] **Step 5: Persist and read severity in the repository**

In `src/server/repository.ts`, in `createRequest`'s `.values({ ... })`, add `severity` after `description`:

```ts
        title: input.title,
        description: input.description,
        severity: input.severity,
```

In `toRequestRecord`, add `severity` after `linearStateType`:

```ts
    linearStateType: row.linearStateType,
    severity: row.severity,
```

- [ ] **Step 6: Update the create handler**

In `src/server/app.ts`, replace the part of the `.post("/requests", ...)` handler after validation succeeds (the `const linearIssue = ...` / `const record = ...` / `return ...` block) with:

```ts
      const { severity, ...issueInput } = input
      const linearIssue = await deps.linear.createHelpdeskIssue({
        ...issueInput,
        requesterEmail: session.user.email,
        priority: severity,
      })
      const record = await deps.repo.createRequest({
        requesterUserId: session.user.id,
        requesterEmail: session.user.email,
        ...issueInput,
        severity,
        linearIssue,
        linearTeamId: deps.config.linear.teamId,
      })

      return json({ request: serializeRequest(record) }, 201)
```

(`serializeRequest` needs no change — it spreads `...record`, which now includes `severity`.)

- [ ] **Step 7: Run tests + typecheck to verify green**

Run: `bunx vitest run src/server/__tests__/app.test.ts && bun run typecheck`
Expected: tests PASS, no type errors.

- [ ] **Step 8: Generate and apply the migration**

Run: `bun run db:generate`
Expected: a new file `drizzle/0002_<name>.sql` containing `ALTER TABLE "helpdesk_requests" ADD COLUMN "severity" integer;`, plus updated `drizzle/meta/_journal.json` and a new snapshot.

Ensure the database is running (`docker compose up -d db`), then run: `bun run db:migrate`
Expected: migration applies cleanly.

- [ ] **Step 9: Commit**

```bash
git add src/server/db/schema.ts src/server/types.ts src/server/repository.ts src/server/app.ts src/server/__tests__/app.test.ts drizzle/
git commit -m "feat: persist bug severity and wire it through request create"
```

---

## Task 4: Image upload endpoint

**Files:**
- Modify: `src/server/app.ts`
- Test: `src/server/__tests__/app.test.ts`

- [ ] **Step 1: Add the failing upload tests**

In `src/server/__tests__/app.test.ts`, add a new top-level `describe` block (after the existing `describe("createApiApp", ...)` block):

```ts
describe("POST /api/uploads", () => {
  function makeApp(overrides?: {
    uploadAsset?: ReturnType<typeof vi.fn>
    getSession?: ReturnType<typeof vi.fn>
  }) {
    const linear = {
      createHelpdeskIssue: vi.fn(),
      createHelpdeskIssueDetailsComment: vi.fn(),
      createIssueComment: vi.fn(),
      listIssueComments: vi.fn(async () => []),
      uploadAsset:
        overrides?.uploadAsset ??
        vi.fn(async () => ({ assetUrl: "https://uploads.linear.app/abc.png" })),
    }
    const app = createApiApp({
      config,
      repo: makeRepo(),
      linear,
      auth: { getSession: overrides?.getSession ?? vi.fn(async () => session) },
    })
    return { app, linear }
  }

  it("uploads a pasted image to Linear and returns the asset URL", async () => {
    const { app, linear } = makeApp()

    const response = await app.fetch(
      new Request("http://localhost/api/uploads", {
        method: "POST",
        headers: { "content-type": "image/png", "x-filename": "shot.png" },
        body: new Uint8Array([1, 2, 3, 4]),
      })
    )

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toEqual({
      assetUrl: "https://uploads.linear.app/abc.png",
      filename: "shot.png",
    })
    expect(linear.uploadAsset).toHaveBeenCalled()
  })

  it("rejects non-image content types", async () => {
    const { app } = makeApp()

    const response = await app.fetch(
      new Request("http://localhost/api/uploads", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: new Uint8Array([1, 2, 3]),
      })
    )

    expect(response.status).toBe(400)
  })

  it("rejects uploads over the size limit", async () => {
    const { app } = makeApp()

    const response = await app.fetch(
      new Request("http://localhost/api/uploads", {
        method: "POST",
        headers: { "content-type": "image/png" },
        body: new Uint8Array(20 * 1024 * 1024 + 1),
      })
    )

    expect(response.status).toBe(413)
  })

  it("rejects unauthenticated uploads", async () => {
    const { app } = makeApp({ getSession: vi.fn(async () => null) })

    const response = await app.fetch(
      new Request("http://localhost/api/uploads", {
        method: "POST",
        headers: { "content-type": "image/png" },
        body: new Uint8Array([1, 2, 3]),
      })
    )

    expect(response.status).toBe(401)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bunx vitest run src/server/__tests__/app.test.ts`
Expected: FAIL (no `/uploads` route → 404, not 201/400/413).

- [ ] **Step 3: Add constants and the route**

In `src/server/app.ts`, add these module-level constants after the imports:

```ts
const ALLOWED_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024

function sanitizeFilename(value: string | null): string {
  if (!value) return "image"
  let decoded = value
  try {
    decoded = decodeURIComponent(value)
  } catch {
    decoded = value
  }
  const base = decoded.split(/[\\/]/).pop() ?? "image"
  const cleaned = base.replace(/[^\w.\-]+/g, "_").slice(0, 100)
  return cleaned || "image"
}
```

Add the route in the Elysia chain, right after the `.post("/requests/:id/comments", ...)` route and before `.post("/linear/webhook", ...)`:

```ts
    .post("/uploads", async ({ request }) => {
      const deps = getDependencies()
      const session = await requireAuthorizedSession(deps, request.headers)
      if (session instanceof Response) return session

      const contentType = (request.headers.get("content-type") ?? "")
        .split(";")[0]
        .trim()
        .toLowerCase()
      if (!ALLOWED_IMAGE_TYPES.includes(contentType)) {
        return json(
          { error: "validation_error", issues: ["Unsupported image type"] },
          400
        )
      }

      const bytes = new Uint8Array(await request.arrayBuffer())
      if (bytes.byteLength === 0) {
        return json({ error: "validation_error", issues: ["Empty file"] }, 400)
      }
      if (bytes.byteLength > MAX_UPLOAD_BYTES) {
        return json({ error: "file_too_large" }, 413)
      }

      const filename = sanitizeFilename(request.headers.get("x-filename"))
      const asset = await deps.linear.uploadAsset({
        contentType,
        filename,
        bytes,
      })

      return json({ assetUrl: asset.assetUrl, filename }, 201)
    })
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bunx vitest run src/server/__tests__/app.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/app.ts src/server/__tests__/app.test.ts
git commit -m "feat: add authenticated image upload endpoint"
```

---

## Task 5: Client API helpers

**Files:**
- Modify: `src/lib/helpdesk-api.ts`

- [ ] **Step 1: Add severity to the type and an upload helper**

In `src/lib/helpdesk-api.ts`, add `severity` to the `PortalRequest` type (after `linearStateType`):

```ts
  linearStateType: string
  severity: number | null
```

Add an `uploadImage` helper (place it after `apiPost`):

```ts
export async function uploadImage(
  file: File
): Promise<{ assetUrl: string; filename: string }> {
  const response = await fetch("/api/uploads", {
    method: "POST",
    credentials: "include",
    headers: {
      "content-type": file.type,
      "x-filename": encodeURIComponent(file.name),
    },
    body: file,
  })

  return readJson<{ assetUrl: string; filename: string }>(response)
}
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/helpdesk-api.ts
git commit -m "feat: add severity field and image upload client helper"
```

---

## Task 6: Severity badge, paste-upload hook, description renderer (shared UI units)

**Files:**
- Create: `src/components/severity-badge.tsx`
- Create: `src/lib/use-paste-image-upload.ts`
- Create: `src/components/description-body.tsx`

- [ ] **Step 1: Create the severity badge**

Create `src/components/severity-badge.tsx`:

```tsx
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

const SEVERITY: Record<number, { label: string; dot: string }> = {
  1: { label: "Urgent", dot: "bg-destructive" },
  2: { label: "High", dot: "bg-status-triage" },
  3: { label: "Medium", dot: "bg-foreground/40" },
  4: { label: "Low", dot: "bg-muted-foreground/40" },
}

export function SeverityBadge({
  priority,
  className,
}: {
  priority: number | null
  className?: string
}) {
  if (priority == null) return null
  const meta = SEVERITY[priority]
  if (!meta) return null

  return (
    <Badge variant="outline" className={className}>
      <span className={cn("size-1.5 rounded-full", meta.dot)} aria-hidden />
      {meta.label}
    </Badge>
  )
}
```

- [ ] **Step 2: Create the paste-upload hook**

Create `src/lib/use-paste-image-upload.ts`:

```ts
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
      const start = textarea.selectionStart ?? textarea.value.length
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
```

- [ ] **Step 3: Create the image-aware description renderer**

Create `src/components/description-body.tsx`:

```tsx
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
```

- [ ] **Step 4: Typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/severity-badge.tsx src/lib/use-paste-image-upload.ts src/components/description-body.tsx
git commit -m "feat: add severity badge, paste-upload hook, description renderer"
```

---

## Task 7: Rebuild the new-request form

**Files:**
- Modify: `src/routes/requests/new.tsx`

- [ ] **Step 1: Replace the form**

Replace the entire contents of `src/routes/requests/new.tsx` with:

```tsx
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router"
import { useState } from "react"

import { PageShell } from "@/components/page-shell"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import type { PortalRequest } from "@/lib/helpdesk-api"
import { ApiError, apiPost } from "@/lib/helpdesk-api"
import { requirePortalAuth } from "@/lib/route-guards"
import { usePasteImageUpload } from "@/lib/use-paste-image-upload"
import { cn } from "@/lib/utils"

export const Route = createFileRoute("/requests/new")({
  beforeLoad: requirePortalAuth,
  component: NewRequest,
})

const SEVERITY_OPTIONS = [
  { value: "urgent", label: "Urgent" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
] as const

function NewRequest() {
  const navigate = useNavigate()
  const [title, setTitle] = useState("")
  const [severity, setSeverity] = useState("medium")
  const [expectedBehaviour, setExpectedBehaviour] = useState("")
  const [currentBehaviour, setCurrentBehaviour] = useState("")
  const [stepsToReproduce, setStepsToReproduce] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const expectedPaste = usePasteImageUpload(setExpectedBehaviour, setUploadError)
  const currentPaste = usePasteImageUpload(setCurrentBehaviour, setUploadError)
  const reproPaste = usePasteImageUpload(setStepsToReproduce, setUploadError)
  const uploadsPending =
    expectedPaste.pending + currentPaste.pending + reproPaste.pending

  return (
    <PageShell
      backLabel="Requests"
      title="New request"
      description="Submitting this form creates a Linear issue in the Base team."
      width="narrow"
    >
      <Card>
        <CardContent>
          <form
            className="flex flex-col gap-5"
            onSubmit={(event) => {
              event.preventDefault()
              setError(null)
              setSubmitting(true)
              void apiPost<{ request: PortalRequest }>("/api/requests", {
                title,
                severity,
                expectedBehaviour,
                currentBehaviour,
                stepsToReproduce,
              })
                .then(({ request }) =>
                  navigate({
                    to: "/requests/$requestId",
                    params: { requestId: request.id },
                  })
                )
                .catch((requestError) => {
                  if (
                    requestError instanceof ApiError &&
                    requestError.status === 401
                  ) {
                    void navigate({ to: "/login" })
                    return
                  }

                  setError("Request could not be submitted.")
                })
                .finally(() => setSubmitting(false))
            }}
          >
            <div className="grid gap-2">
              <Label htmlFor="request-title">Title</Label>
              <Input
                id="request-title"
                required
                minLength={3}
                maxLength={160}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </div>

            <fieldset className="grid gap-2">
              <legend className="text-sm font-medium">Severity</legend>
              <div className="flex flex-wrap gap-2">
                {SEVERITY_OPTIONS.map((option) => (
                  <label
                    key={option.value}
                    className={cn(
                      "cursor-pointer rounded-4xl border border-border px-3 py-1 text-sm font-medium transition-colors",
                      "has-[:checked]:border-transparent has-[:checked]:bg-primary has-[:checked]:text-primary-foreground",
                      "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/50"
                    )}
                  >
                    <input
                      type="radio"
                      name="severity"
                      value={option.value}
                      checked={severity === option.value}
                      onChange={(event) => setSeverity(event.target.value)}
                      className="sr-only"
                    />
                    {option.label}
                  </label>
                ))}
              </div>
            </fieldset>

            <BugField
              id="request-expected"
              label="Expected behaviour"
              placeholder="What should happen?"
              value={expectedBehaviour}
              onChange={setExpectedBehaviour}
              onPaste={expectedPaste.onPaste}
            />
            <BugField
              id="request-current"
              label="Current behaviour"
              placeholder="What actually happens?"
              value={currentBehaviour}
              onChange={setCurrentBehaviour}
              onPaste={currentPaste.onPaste}
            />
            <BugField
              id="request-repro"
              label="Steps to reproduce"
              placeholder="1. … 2. … 3. …"
              value={stepsToReproduce}
              onChange={setStepsToReproduce}
              onPaste={reproPaste.onPaste}
            />

            <p className="text-xs text-muted-foreground">
              Paste screenshots directly into any field — they upload to Linear
              automatically.
            </p>

            {uploadError ? (
              <p className="text-sm text-destructive">{uploadError}</p>
            ) : null}
            {error ? <p className="text-sm text-destructive">{error}</p> : null}

            <div className="flex items-center justify-end gap-2">
              {uploadsPending > 0 ? (
                <span className="text-xs text-muted-foreground">
                  Uploading image…
                </span>
              ) : null}
              <Link to="/" className={buttonVariants({ variant: "outline" })}>
                Cancel
              </Link>
              <Button type="submit" disabled={submitting || uploadsPending > 0}>
                {submitting ? "Submitting..." : "Submit request"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </PageShell>
  )
}

function BugField({
  id,
  label,
  placeholder,
  value,
  onChange,
  onPaste,
}: {
  id: string
  label: string
  placeholder: string
  value: string
  onChange: (value: string) => void
  onPaste: React.ClipboardEventHandler<HTMLTextAreaElement>
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Textarea
        id={id}
        required
        minLength={1}
        maxLength={5000}
        rows={4}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        onPaste={onPaste}
      />
    </div>
  )
}
```

- [ ] **Step 2: Typecheck, lint, format**

Run: `bun run typecheck && bun run lint && bun run format`
Expected: PASS / clean.

- [ ] **Step 3: Commit**

```bash
git add src/routes/requests/new.tsx
git commit -m "feat: split new-request form with severity and image paste"
```

---

## Task 8: Show severity + rendered description in list and detail

**Files:**
- Modify: `src/routes/index.tsx`
- Modify: `src/routes/requests/$requestId.tsx`

- [ ] **Step 1: Add the severity badge to list rows**

In `src/routes/index.tsx`, add the import:

```tsx
import { SeverityBadge } from "@/components/severity-badge"
```

In the request row `<Link>`, add a `SeverityBadge` immediately before the status `Badge` (hidden on the smallest screens to keep the row uncluttered):

```tsx
                  <SeverityBadge
                    priority={request.severity}
                    className="hidden shrink-0 sm:inline-flex"
                  />
                  <Badge
                    variant="outline"
                    className={`shrink-0 ${statusClassName(request.linearStateType)}`}
                  >
                    {request.linearStateName}
                  </Badge>
```

- [ ] **Step 2: Add severity to the detail header and render the description**

In `src/routes/requests/$requestId.tsx`, add imports:

```tsx
import { DescriptionBody } from "@/components/description-body"
import { SeverityBadge } from "@/components/severity-badge"
```

In the `PageShell` `actions` prop for the ready state, render the severity badge next to the status badge:

```tsx
      actions={
        <>
          <SeverityBadge priority={request.severity} />
          <Badge
            variant="outline"
            className={statusClassName(request.linearStateType)}
          >
            {request.linearStateName}
          </Badge>
        </>
      }
```

Replace the Description card body — change:

```tsx
              <p className="text-sm leading-6 whitespace-pre-wrap text-muted-foreground">
                {request.description}
              </p>
```

to:

```tsx
              <DescriptionBody text={request.description} />
```

- [ ] **Step 3: Typecheck, lint, format**

Run: `bun run typecheck && bun run lint && bun run format`
Expected: PASS / clean.

- [ ] **Step 4: Commit**

```bash
git add src/routes/index.tsx src/routes/requests/$requestId.tsx
git commit -m "feat: show severity badge and render description images"
```

---

## Task 9: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full suite**

Run: `bun run check && bun run lint && bun run typecheck && bun run test`
Expected: Prettier clean, ESLint clean, no type errors, all tests pass (existing + new).

- [ ] **Step 2: Visual check of the new form and detail**

Because the form and detail pages are behind Google OAuth (no headless login), verify layout with the preview-injection approach used earlier in this project: start the preview server (`.claude/launch.json` → `lineardesk-dev`), then inject faithful snapshots and screenshot in light + dark at desktop and 375px:
- New form: title, four severity pills with **Medium** selected (filled lime), three labelled textareas, the paste hint, Submit/Cancel. Confirm pills wrap cleanly and there is no horizontal overflow at 375px.
- Detail: a "Description" card whose text contains one `![shot.png](https://…)` ref, to confirm `DescriptionBody` renders text plus an image/link; confirm the severity badge sits next to the status badge in the header.

- [ ] **Step 3: Final commit (if formatting changed anything)**

```bash
git add -A
git commit -m "chore: formatting after bug-report form feature" || echo "nothing to commit"
```

---

## Notes / out of scope

- Severity is set at creation only; the Linear webhook is not extended to sync priority changes back (future).
- Image paste is wired on the new-request form only, not the detail reply box (future).
- Linear asset URLs may be auth-gated; the guaranteed outcome is the image rendering inside the Linear issue. `DescriptionBody` falls back to a "🖼 screenshot" link if the asset image fails to load in our portal.
```
