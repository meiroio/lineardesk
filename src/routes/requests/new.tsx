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

export const Route = createFileRoute("/requests/new")({
  beforeLoad: requirePortalAuth,
  component: NewRequest,
})

function NewRequest() {
  const navigate = useNavigate()
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

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
                description,
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
            <div className="grid gap-2">
              <Label htmlFor="request-description">Description</Label>
              <Textarea
                id="request-description"
                required
                minLength={10}
                maxLength={5000}
                rows={8}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <div className="flex justify-end gap-2">
              <Link to="/" className={buttonVariants({ variant: "outline" })}>
                Cancel
              </Link>
              <Button type="submit" disabled={submitting}>
                {submitting ? "Submitting..." : "Submit request"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </PageShell>
  )
}
