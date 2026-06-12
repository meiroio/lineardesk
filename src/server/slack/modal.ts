import type { SlackFileRef } from "../types"

export type TicketModalMeta = {
  channel: string
  messageTs: string
  threadTs: string
  files: SlackFileRef[]
}

const SEVERITY_OPTIONS = [
  { text: "Urgent", value: "urgent" },
  { text: "High", value: "high" },
  { text: "Medium", value: "medium" },
  { text: "Low", value: "low" },
]

export function buildTicketModal(input: {
  descriptionPrefill?: string
  privateMetadata: TicketModalMeta
}) {
  return {
    type: "modal",
    callback_id: "slack_ticket_submit",
    private_metadata: JSON.stringify(input.privateMetadata),
    title: { type: "plain_text", text: "New LinearDesk ticket" },
    submit: { type: "plain_text", text: "Create" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "input",
        block_id: "title",
        label: { type: "plain_text", text: "Title" },
        element: { type: "plain_text_input", action_id: "title_input" },
      },
      {
        type: "input",
        block_id: "description",
        label: { type: "plain_text", text: "Description" },
        element: {
          type: "plain_text_input",
          action_id: "description_input",
          multiline: true,
          initial_value: input.descriptionPrefill ?? "",
        },
      },
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
  return {
    slackUserId: payload.user.id,
    title: v.title?.title_input?.value?.trim() ?? "",
    description: v.description?.description_input?.value?.trim() ?? "",
    severityLabel: v.severity?.severity_input?.selected_option?.value ?? "",
    meta: JSON.parse(payload.view.private_metadata) as TicketModalMeta,
  }
}
