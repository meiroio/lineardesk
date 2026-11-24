import { createFileRoute } from "@tanstack/react-router"
import { RiArrowRightUpLine, RiGithubFill } from "@remixicon/react"
import { Button } from "@ui-sdk/react/button"

import { PageShell } from "@/components/page-shell"

export const REPOSITORY_URL = "https://github.com/meiroio/lineardesk"

export const Route = createFileRoute("/about")({
  head: () => ({ meta: [{ title: "About · LinearDesk" }] }),
  component: About,
})

const flow = [
  {
    title: "File a request",
    body: "From the web portal or straight from a Slack thread. Mention @LinearDesk and it drafts the ticket from the conversation.",
  },
  {
    title: "It lands in Linear",
    body: "Each request becomes a Linear issue in the right team, with screenshots attached. Slack requests keep a link to their thread.",
  },
  {
    title: "Follow it to resolution",
    body: "Status, replies and shared updates sync back from Linear, so customers can track progress without a Linear account.",
  },
]

const stack = [
  "TanStack Start and React 19",
  "ui-sdk components",
  "Elysia API on Bun",
  "Better Auth with Google and email links",
  "Drizzle on Neon Postgres",
  "Linear SDK and webhooks",
  "Slack intake with Gemini drafting",
]

function About() {
  return (
    <PageShell
      title="About LinearDesk"
      description="A small helpdesk portal that puts Linear behind a customer-facing front door."
      backLabel="Requests"
      breadcrumb="About"
      width="narrow"
    >
      <section aria-labelledby="about-flow" className="flex flex-col gap-4">
        <h2 id="about-flow" className="text-sm font-semibold">
          How it works
        </h2>
        <ol className="grid gap-3 sm:grid-cols-3">
          {flow.map((step, index) => (
            <li
              key={step.title}
              className="flex flex-col gap-2 rounded-xl border bg-card p-4"
            >
              <span className="font-mono text-[11px] text-muted-foreground">
                {String(index + 1).padStart(2, "0")}
              </span>
              <h3 className="text-[13px] font-semibold">{step.title}</h3>
              <p className="text-[13px] leading-relaxed text-muted-foreground">
                {step.body}
              </p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="about-access" className="flex flex-col gap-2">
        <h2 id="about-access" className="text-sm font-semibold">
          Who can see what
        </h2>
        <p className="max-w-prose text-[13px] leading-relaxed text-muted-foreground">
          Access is invitation-only. Customers see the requests filed by their
          own organization, and only Linear comments marked for clients. Meiro
          staff can browse every organization and triage severity and
          assignment.
        </p>
      </section>

      <section aria-labelledby="about-stack" className="flex flex-col gap-3">
        <h2 id="about-stack" className="text-sm font-semibold">
          Built with
        </h2>
        <ul className="flex flex-wrap gap-2">
          {stack.map((item) => (
            <li
              key={item}
              className="rounded-full border px-2.5 py-1 text-xs text-muted-foreground"
            >
              {item}
            </li>
          ))}
        </ul>
      </section>

      <section
        aria-labelledby="about-source"
        className="flex flex-col items-start gap-3 rounded-xl border bg-card p-5"
      >
        <h2 id="about-source" className="text-sm font-semibold">
          Source code
        </h2>
        <p className="text-[13px] text-muted-foreground">
          The code is public on GitHub under a Commons Clause license.
        </p>
        <Button
          data-variant="solid"
          render={<a href={REPOSITORY_URL} target="_blank" rel="noreferrer" />}
        >
          <RiGithubFill aria-hidden />
          meiroio/lineardesk on GitHub
          <RiArrowRightUpLine aria-hidden />
        </Button>
      </section>
    </PageShell>
  )
}
