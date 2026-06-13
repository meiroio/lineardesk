import type { SlackFileRef } from "../types"

export type TicketModalMeta = {
  channel: string
  messageTs: string
  threadTs: string
  files: SlackFileRef[]
}

export type TicketModalPrefill = {
  title?: string
  expectedBehaviour?: string
  currentBehaviour?: string
  stepsToReproduce?: string
}

const SEVERITY_OPTIONS = [
  { text: "Urgent", value: "urgent" },
  { text: "High", value: "high" },
  { text: "Medium", value: "medium" },
  { text: "Low", value: "low" },
]

const TEXT_FIELDS: {
  id: string
  label: string
  key: keyof TicketModalPrefill
}[] = [
  { id: "title", label: "Title", key: "title" },
  {
    id: "expectedBehaviour",
    label: "Expected behaviour",
    key: "expectedBehaviour",
  },
  {
    id: "currentBehaviour",
    label: "Current behaviour",
    key: "currentBehaviour",
  },
  {
    id: "stepsToReproduce",
    label: "Steps to reproduce",
    key: "stepsToReproduce",
  },
]

export function buildLoadingModal() {
  return {
    type: "modal",
    title: { type: "plain_text", text: "New LinearDesk ticket" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: ":sparkles: Drafting your ticket from the thread…",
        },
      },
    ],
  }
}

export function buildTicketModal(input: {
  prefill?: TicketModalPrefill
  privateMetadata: TicketModalMeta
}) {
  const prefill = input.prefill ?? {}
  return {
    type: "modal",
    callback_id: "slack_ticket_submit",
    private_metadata: JSON.stringify(input.privateMetadata),
    title: { type: "plain_text", text: "New LinearDesk ticket" },
    submit: { type: "plain_text", text: "Create" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      ...TEXT_FIELDS.map((f) => ({
        type: "input",
        block_id: f.id,
        label: { type: "plain_text", text: f.label },
        element: {
          type: "plain_text_input",
          action_id: `${f.id}_input`,
          multiline: f.id !== "title",
          initial_value: prefill[f.key] ?? "",
        },
      })),
      {
        type: "input",
        block_id: "severity",
        label: { type: "plain_text", text: "Severity" },
        element: {
          type: "static_select",
          action_id: "severity_input",
          initial_option: {
            text: { type: "plain_text", text: "Medium" },
            value: "medium",
          },
          options: SEVERITY_OPTIONS.map((o) => ({
            text: { type: "plain_text", text: o.text },
            value: o.value,
          })),
        },
      },
    ],
  }
}

export function parseTicketSubmission(payload: {
  user: { id: string }
  view: {
    private_metadata: string
    state: {
      values: Record<
        string,
        | Record<
            string,
            { value?: string; selected_option?: { value: string } } | undefined
          >
        | undefined
      >
    }
  }
}) {
  const v = payload.view.state.values
  const field = (id: string) => v[id]?.[`${id}_input`]?.value?.trim() ?? ""
  return {
    slackUserId: payload.user.id,
    title: field("title"),
    expectedBehaviour: field("expectedBehaviour"),
    currentBehaviour: field("currentBehaviour"),
    stepsToReproduce: field("stepsToReproduce"),
    severityLabel: v.severity?.severity_input?.selected_option?.value ?? "",
    meta: JSON.parse(payload.view.private_metadata) as TicketModalMeta,
  }
}
