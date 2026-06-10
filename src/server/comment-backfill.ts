import type { HelpdeskRepository, LinearGateway } from "./types"

export type BackfillMissingDetailsCommentsInput = {
  repo: HelpdeskRepository
  linear: LinearGateway
  limit: number
}

export type BackfillMissingDetailsCommentsResult = {
  processed: number
  commented: number
  failed: number
}

export async function backfillMissingDetailsComments({
  repo,
  linear,
  limit,
}: BackfillMissingDetailsCommentsInput): Promise<BackfillMissingDetailsCommentsResult> {
  const requests = await repo.listRequestsMissingDetailsComment(limit)
  let commented = 0
  let failed = 0

  for (const request of requests) {
    try {
      const comment = await linear.createHelpdeskIssueDetailsComment({
        issueId: request.linearIssueId,
        description: request.description,
        requesterEmail: request.requesterEmail,
      })

      await repo.markDetailsCommentCreated(request.id, comment.id)
      commented += 1
    } catch {
      failed += 1
    }
  }

  return {
    processed: requests.length,
    commented,
    failed,
  }
}
