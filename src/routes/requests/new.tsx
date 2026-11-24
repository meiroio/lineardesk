import {
  Link,
  createFileRoute,
  redirect,
  useNavigate,
} from "@tanstack/react-router"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Button } from "@ui-sdk/react/button"
import { Field, FieldError, FieldLabel } from "@ui-sdk/react/field"
import { Input } from "@ui-sdk/react/input"
import {
  SegmentedControl,
  SegmentedControlIndicator,
  SegmentedControlItem,
} from "@ui-sdk/react/segmented-control"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectTrigger,
  SelectValue,
} from "@ui-sdk/react/select"
import { Textarea } from "@ui-sdk/react/textarea"
import { useState } from "react"

import { ImageDropzone } from "@/components/image-dropzone"
import { PageShell } from "@/components/page-shell"
import { Card, CardContent } from "@/components/ui/card"
import type { PortalRequest } from "@/lib/helpdesk-api"
import { ApiError, requestKeys, teamKeys } from "@/lib/helpdesk-api"
import { usePasteImageUpload } from "@/lib/use-paste-image-upload"

export const Route = createFileRoute("/requests/new")({
  beforeLoad: async ({ context }) => {
    const access = await context.requirePortalAuth()
    if (access.portalAccess.organizationId === null) {
      throw redirect({ to: "/" })
    }
    return access
  },
  component: NewRequest,
})

const SEVERITY_OPTIONS = [
  { value: "urgent", label: "Urgent" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
] as const

function NewRequest() {
  const { api } = Route.useRouteContext()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [title, setTitle] = useState("")
  const [teamId, setTeamId] = useState("")
  const [severity, setSeverity] = useState("medium")
  const [expectedBehaviour, setExpectedBehaviour] = useState("")
  const [currentBehaviour, setCurrentBehaviour] = useState("")
  const [stepsToReproduce, setStepsToReproduce] = useState("")
  const [attachments, setAttachments] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const {
    data: teamData,
    status: teamStatus,
    error: teamError,
  } = useQuery({
    queryKey: teamKeys.list,
    queryFn: api.fetchTeams,
  })
  const teams = teamData?.teams ?? []
  const defaultTeamId = teamData?.defaultTeamId ?? ""
  const selectedTeamId = teams.some((team) => team.id === teamId)
    ? teamId
    : teams.some((team) => team.id === defaultTeamId)
      ? defaultTeamId
      : (teams[0]?.id ?? "")

  const expectedPaste = usePasteImageUpload(
    api.uploadImage,
    setExpectedBehaviour,
    setUploadError
  )
  const currentPaste = usePasteImageUpload(
    api.uploadImage,
    setCurrentBehaviour,
    setUploadError
  )
  const reproPaste = usePasteImageUpload(
    api.uploadImage,
    setStepsToReproduce,
    setUploadError
  )
  const attachmentUpload = usePasteImageUpload(
    api.uploadImage,
    setAttachments,
    setUploadError
  )
  const uploadsPending =
    expectedPaste.pending +
    currentPaste.pending +
    reproPaste.pending +
    attachmentUpload.pending

  return (
    <PageShell
      backLabel="Requests"
      title="New request"
      description="Submitting this form creates a Linear issue in the selected team."
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
              void api
                .apiPost<{ request: PortalRequest }>("/api/requests", {
                  title,
                  severity,
                  teamId: selectedTeamId,
                  expectedBehaviour,
                  currentBehaviour,
                  stepsToReproduce,
                  attachments,
                })
                .then(({ request }) => {
                  queryClient.setQueryData(
                    requestKeys.detail(request.id),
                    request,
                    { updatedAt: 0 }
                  )
                  void queryClient.invalidateQueries({
                    queryKey: requestKeys.list,
                  })
                  return navigate({
                    to: "/requests/$requestId",
                    params: { requestId: request.id },
                  })
                })
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
            <Field name="title">
              <FieldLabel>Title</FieldLabel>
              <Input
                required
                pattern=".{3,}"
                maxLength={160}
                value={title}
                onValueChange={setTitle}
              />
              <FieldError match="valueMissing">Enter a title.</FieldError>
              <FieldError match="patternMismatch">
                Use at least 3 characters.
              </FieldError>
            </Field>

            <Field name="teamId" invalid={teamError ? true : undefined}>
              <FieldLabel>Team</FieldLabel>
              <Select
                required
                placeholder={
                  teamStatus === "pending"
                    ? "Loading teams…"
                    : "No teams available"
                }
                disabled={teamStatus !== "success" || teams.length === 0}
                items={teams.map((team) => ({
                  value: team.id,
                  label: `${team.name} (${team.key})`,
                }))}
                value={selectedTeamId || null}
                onValueChange={(value) => setTeamId(value ?? "")}
              >
                <SelectTrigger className="w-full justify-between">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="start">
                  {teams.map((team) => (
                    <SelectItem
                      key={team.id}
                      value={team.id}
                      label={`${team.name} (${team.key})`}
                    >
                      {team.name} ({team.key})
                      <SelectItemIndicator />
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {teamError ? (
                <FieldError match>Teams could not be loaded.</FieldError>
              ) : null}
            </Field>

            <Field>
              <FieldLabel>Severity</FieldLabel>
              <SegmentedControl
                name="severity"
                value={severity}
                onValueChange={(value) => {
                  if (value) setSeverity(value)
                }}
                className="self-start"
              >
                <SegmentedControlIndicator />
                {SEVERITY_OPTIONS.map((option) => (
                  <SegmentedControlItem key={option.value} value={option.value}>
                    {option.label}
                  </SegmentedControlItem>
                ))}
              </SegmentedControl>
            </Field>

            <BugField
              label="Expected behaviour"
              placeholder="What should happen?"
              value={expectedBehaviour}
              onChange={setExpectedBehaviour}
              onPaste={expectedPaste.onPaste}
            />
            <BugField
              label="Current behaviour"
              placeholder="What actually happens?"
              value={currentBehaviour}
              onChange={setCurrentBehaviour}
              onPaste={currentPaste.onPaste}
            />
            <BugField
              label="Steps to reproduce"
              placeholder="1. … 2. … 3. …"
              value={stepsToReproduce}
              onChange={setStepsToReproduce}
              onPaste={reproPaste.onPaste}
            />

            <ImageDropzone
              imageUpload={attachmentUpload}
              previewText={attachments}
              onClear={() => setAttachments("")}
            />

            <p className="text-xs text-muted-foreground">
              You can also paste a screenshot directly into any text field.
            </p>

            {uploadError ? (
              <p role="alert" className="text-sm text-destructive">
                {uploadError}
              </p>
            ) : null}
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}

            <div className="flex items-center justify-end gap-2">
              {uploadsPending > 0 ? (
                <span className="text-xs text-muted-foreground">
                  Uploading image…
                </span>
              ) : null}
              <Button render={<Link to="/" />}>Cancel</Button>
              <Button
                type="submit"
                data-variant="solid"
                disabled={submitting || uploadsPending > 0 || !selectedTeamId}
                focusableWhenDisabled
              >
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
  label,
  placeholder,
  value,
  onChange,
  onPaste,
}: {
  label: string
  placeholder: string
  value: string
  onChange: (value: string) => void
  onPaste: React.ClipboardEventHandler<HTMLTextAreaElement>
}) {
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <Textarea
        required
        maxLength={5000}
        rows={4}
        value={value}
        placeholder={placeholder}
        onValueChange={onChange}
        onPaste={onPaste}
      />
      <FieldError match="valueMissing">
        Describe the {label.toLowerCase()}.
      </FieldError>
    </Field>
  )
}
