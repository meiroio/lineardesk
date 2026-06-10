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

  const expectedPaste = usePasteImageUpload(
    setExpectedBehaviour,
    setUploadError
  )
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
              setUploadError(null)
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
                      "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/50 has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-background"
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
