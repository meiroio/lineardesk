import type {
  AppConfig,
  HelpdeskRepository,
  LinearGateway,
  LinearIssueSnapshot,
  OrgAccessRepository,
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

export class SlackEmailDomainNotAllowedError extends Error {
  constructor() {
    super("Slack email domain is not approved")
    this.name = "SlackEmailDomainNotAllowedError"
  }
}

export type SlackTicketDeps = {
  config: Pick<AppConfig, "linear">
  repo: Pick<HelpdeskRepository, "getUserIdByEmail" | "createRequest">
  linear: Pick<LinearGateway, "createHelpdeskIssue" | "uploadAsset">
  slack: Pick<SlackGateway, "getUserEmail" | "downloadFile" | "getPermalink">
  orgAccess: Pick<OrgAccessRepository, "findActiveOrganizationForEmail">
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
  const organization =
    await deps.orgAccess.findActiveOrganizationForEmail(email)
  if (!organization) throw new SlackEmailDomainNotAllowedError()

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

  // Link back to the originating Slack thread (shortcut flow only — a blank
  // threadTs means a /ticket with no source message). Non-fatal: a failed
  // permalink lookup must not block ticket creation.
  let threadLink: string | null = null
  if (input.threadTs) {
    try {
      threadLink = await deps.slack.getPermalink({
        channel: input.channel,
        messageTs: input.threadTs,
      })
    } catch {
      threadLink = null
    }
  }

  const description = [
    input.description,
    markdown.length > 0 ? markdown.join("\n") : null,
    threadLink ? `Slack thread: ${threadLink}` : null,
  ]
    .filter(Boolean)
    .join("\n\n")

  const issue = await deps.linear.createHelpdeskIssue({
    title: input.title,
    description,
    requesterEmail: email,
    priority: input.severity,
  })

  const requesterUserId = await deps.repo.getUserIdByEmail(email)

  const record = await deps.repo.createRequest({
    requesterUserId,
    organizationId: organization.organizationId,
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
