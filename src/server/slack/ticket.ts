import type {
  AppConfig,
  HelpdeskRepository,
  LinearGateway,
  LinearIssueSnapshot,
  RequestRecord,
  SlackFileRef,
  SlackGateway,
} from "../types"

export class SlackEmailMissingError extends Error {
  constructor() {
    super("Slack account has no email")
    this.name = "SlackEmailMissingError"
  }
}

export type SlackTicketDeps = {
  config: Pick<AppConfig, "linear">
  repo: Pick<HelpdeskRepository, "getUserIdByEmail" | "createRequest">
  linear: Pick<LinearGateway, "createHelpdeskIssue" | "uploadAsset">
  slack: Pick<SlackGateway, "getUserEmail" | "downloadFile">
}

export type CreateSlackTicketInput = {
  slackUserId: string
  title: string
  description: string
  severity: number
  channel: string
  threadTs: string
  files: SlackFileRef[]
}

export type CreateSlackTicketResult = {
  record: RequestRecord
  issue: LinearIssueSnapshot
  droppedImages: number
}

const IMAGE_MIME = /^image\//

export async function createSlackTicket(
  deps: SlackTicketDeps,
  input: CreateSlackTicketInput
): Promise<CreateSlackTicketResult> {
  const email = await deps.slack.getUserEmail(input.slackUserId)
  if (!email) throw new SlackEmailMissingError()

  let droppedImages = 0
  const markdown: string[] = []
  for (const file of input.files.filter((f) => IMAGE_MIME.test(f.mimetype))) {
    try {
      const { bytes, contentType } = await deps.slack.downloadFile(
        file.urlPrivate
      )
      const { assetUrl } = await deps.linear.uploadAsset({
        contentType: contentType || file.mimetype,
        filename: file.name,
        bytes,
      })
      markdown.push(`![${file.name}](${assetUrl})`)
    } catch {
      droppedImages += 1
    }
  }

  const description =
    markdown.length > 0
      ? `${input.description}\n\n${markdown.join("\n")}`
      : input.description

  const issue = await deps.linear.createHelpdeskIssue({
    title: input.title,
    description,
    requesterEmail: email,
    priority: input.severity,
  })

  const requesterUserId = await deps.repo.getUserIdByEmail(email)

  const record = await deps.repo.createRequest({
    requesterUserId,
    requesterEmail: email,
    title: input.title,
    description,
    severity: input.severity,
    linearIssue: issue,
    linearTeamId: deps.config.linear.teamId,
    source: "slack",
    slackChannelId: input.channel,
    slackMessageTs: input.threadTs,
  })

  return { record, issue, droppedImages }
}
