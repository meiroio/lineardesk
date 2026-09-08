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

export class SlackTicketCreationUncertainError extends Error {
  constructor(cause: unknown) {
    super("Ticket creation could not be confirmed", { cause })
    this.name = "SlackTicketCreationUncertainError"
  }
}

type SlackRequester = { email: string; organizationId: string }

export type SlackTicketDeps = {
  config: Pick<AppConfig, "linear">
  repo: Pick<HelpdeskRepository, "getUserIdByEmail" | "createRequest">
  linear: Pick<LinearGateway, "createHelpdeskIssue" | "uploadAsset">
  slack: Pick<SlackGateway, "getUserEmail" | "downloadFile" | "getPermalink">
  orgAccess: Pick<OrgAccessRepository, "findActiveOrganizationForEmail">
}

export type CreateSlackTicketInput = {
  slackUserId: string
  resolvedRequester?: SlackRequester
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

export async function resolveSlackRequester(
  deps: Pick<SlackTicketDeps, "slack" | "orgAccess">,
  slackUserId: string
): Promise<SlackRequester> {
  const email = await deps.slack.getUserEmail(slackUserId)
  if (!email) throw new SlackEmailMissingError()
  const organization =
    await deps.orgAccess.findActiveOrganizationForEmail(email)
  if (!organization) throw new SlackEmailDomainNotAllowedError()

  return { email, organizationId: organization.organizationId }
}

export async function createSlackTicket(
  deps: SlackTicketDeps,
  input: CreateSlackTicketInput
): Promise<CreateSlackTicketResult> {
  const { email, organizationId } =
    input.resolvedRequester ??
    (await resolveSlackRequester(deps, input.slackUserId))

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

  const requesterUserId = await deps.repo.getUserIdByEmail(email)

  // Once the external write starts, a timeout does not prove it failed. Keep
  // the event claim on this path so a retry cannot create a second issue.
  try {
    const issue = await deps.linear.createHelpdeskIssue({
      title: input.title,
      description,
      requesterEmail: email,
      teamId: deps.config.linear.teamId,
      priority: input.severity,
    })

    const record = await deps.repo.createRequest({
      requesterUserId,
      organizationId,
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
  } catch (error) {
    throw new SlackTicketCreationUncertainError(error)
  }
}
