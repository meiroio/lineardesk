# Bug report form: severity, split fields, image paste

**Date:** 2026-06-10
**Status:** Approved (pending spec review)

## Overview

Three additions to the new-request flow before MVP:

1. **Bug severity** — a required selector mapped to Linear's native Priority field.
2. **Split form** — replace the single description with three required fields
   (Expected behaviour / Current behaviour / Steps to reproduce), merged into one
   Linear issue description.
3. **Image paste** — paste images into the form; they upload to Linear and embed
   into the merged description. New-request form only.

Persistence is **merged-only**: we store the merged description in the existing
`description` column (unchanged shape) plus one new `severity` column. We do *not*
store the three fields separately.

## 1. Severity → Linear Priority

- UI labels and mapping to Linear priority (integer):
  `Urgent → 1`, `High → 2`, `Medium → 3`, `Low → 4`.
- **Required**, defaults to **Medium** (3).
- The form sends a severity *label* (`urgent | high | medium | low`); the parse
  layer maps it to the priority integer above. That same integer is both passed to
  Linear as `priority` and stored in our `severity` column — i.e. our stored
  `severity` value *is* the Linear priority number.
- Set natively on the issue via `IssueCreateInput.priority` — not duplicated in
  the description text (Linear shows priority in its own UI).
- Stored on our side as a nullable `severity` integer so the list and detail views
  can show a severity badge without re-querying Linear. Legacy rows have `null`
  severity and simply render no badge.
- Severity is set at creation only. We do **not** sync priority changes back from
  the Linear webhook in this iteration (future enhancement).

## 2. Split form → merged description

The form's single description textarea becomes three required textareas, in order:

1. **Expected behaviour**
2. **Current behaviour**
3. **Steps to reproduce**

Title field is unchanged.

### Merge format (dual-readable)

Merged in the parse/validation layer into a single `description` string using plain
section labels (no markdown emphasis) so it reads cleanly both in the Linear issue
and in our plain-text portal detail view:

```
Expected behaviour
<expected text, may contain pasted ![alt](assetUrl) image refs>

Current behaviour
<current text>

Steps to reproduce
<repro text>
```

The existing `buildLinearIssueInput` still prepends `Requester: <email>\n\n` to this
merged string, so the Linear issue body and the details comment are unchanged in
structure — only the description content is now sectioned.

## 3. Image paste (new-request form only)

### Upload endpoint

`POST /api/uploads`

- Auth-gated, reusing `requireAuthorizedSession` (same 401/403 behaviour as other
  routes).
- Accepts a single image. Validates:
  - content-type ∈ `{image/png, image/jpeg, image/gif, image/webp}` → else
    `400 validation_error`.
  - size ≤ **20 MB** → else `413`.
- Streams the bytes through Linear's upload flow; **nothing is persisted on our
  server**:
  1. `linear.uploadAsset(contentType, filename, size)` → `fileUpload` mutation →
     `{ uploadUrl, assetUrl, headers[] }`.
  2. `PUT uploadUrl` with the returned headers and the raw bytes.
  3. Return `{ assetUrl, filename }`.
- A new `uploadAsset` method is added to the `LinearGateway` interface and the
  `LinearSdkGateway` implementation.

### Client paste handling

A reusable paste handler (hook or small wrapper around `Textarea`) applied to the
three fields:

- On paste, inspect `clipboardData.items` for image entries. If found,
  `preventDefault`, read the `File`, and upload via `POST /api/uploads`.
- Insert a placeholder (`![uploading <name>…]()`) at the caret, then replace it
  with `![<name>](<assetUrl>)` on success, or remove it and show an inline error on
  failure.
- Track in-flight uploads; **disable submit while any upload is pending** so the
  form can't be sent with an unresolved placeholder.

### Rendering in our portal

Because the merged `description` may contain `![alt](assetUrl)` refs, the detail
view applies a **minimal, image-only transform** (not a markdown engine): segments
matching the image syntax render as a thumbnail/link via React elements (never
`dangerouslySetInnerHTML`); everything else renders as the existing pre-wrapped
text. Images render reliably in the Linear issue (the primary goal); in our portal
they render if the asset URL loads, otherwise fall back to a "🖼 screenshot" link.
The form previews pasted images instantly from the local blob.

## Data model & API changes

- **DB migration:** add nullable `severity` integer column to `helpdesk_requests`.
  Drizzle generate + migrate.
- **Types:** add `severity` to `RequestRecord` and `CreateRequestRecordInput`;
  add optional `priority` to `CreateHelpdeskIssueInput`; add `uploadAsset` to
  `LinearGateway`.
- **Validation (`parseCreateRequestInput`):** new payload shape
  `{ title, expectedBehaviour, currentBehaviour, stepsToReproduce, severity }`.
  - title: 3–160 (unchanged).
  - each of the three fields: required, non-empty after trim, ≤ 5000 chars.
  - severity: required, one of `urgent | high | medium | low`.
  - Returns `{ title, description (merged), severity (int) }`. The raw fields are
    used only to build the merge; they are not persisted separately.
- **Route (`POST /api/requests`):** pass `priority` into `createHelpdeskIssue` and
  `severity` into `repo.createRequest`. `serializeRequest` includes `severity`.
- **Client API types (`helpdesk-api.ts`):** `PortalRequest` gains `severity`; add an
  upload helper for the paste handler.

## UI

- **New-request form:** title, severity selector (default Medium), three required
  paste-enabled textareas, submit disabled while uploads are pending. Validation
  errors surfaced per the existing pattern. Severity selector uses a shadcn
  `select` (base-maia); fallback to a styled radio/segmented control if the
  registry component is unavailable.
- **List:** add a small severity badge per row alongside the existing status badge.
- **Detail:** severity badge in the header; description card renders the merged
  sections (with the image-only transform).
- All four UI states verified in light + dark, desktop + mobile, as in prior work.

## Testing

- `request-validation`: new field validation (each required, length caps), severity
  validation + mapping, and the merged-description output format.
- `linear`: `buildLinearIssueInput` includes `priority`; `uploadAsset` behaviour
  with a mocked client (happy path + PUT failure).
- `app`: `POST /api/requests` with the new payload (happy + validation errors);
  `POST /api/uploads` happy path (mocked `uploadAsset`), plus rejects for non-image
  content-type, oversize, and unauthenticated.
- Update existing `app`/`validation` tests to the new payload shape. Keep the full
  suite green.

## Out of scope (future)

- Syncing severity/priority back from the Linear webhook.
- Image paste in the reply box on the detail page.
- Storing the three fields separately / a full markdown renderer in the portal.
