import { and, desc, eq, isNull } from "drizzle-orm"
import type { NodePgDatabase } from "drizzle-orm/node-postgres"

import type {
  CreateRequestRecordInput,
  HelpdeskRepository,
  LinearIssueWebhookSnapshot,
  RequestRecord,
} from "./types"
import { getDb } from "./db/client"
import type * as schema from "./db/schema"
import { helpdeskRequests, linearWebhookEvents } from "./db/schema"

type Database = NodePgDatabase<typeof schema>
type HelpdeskRequestRow = typeof helpdeskRequests.$inferSelect

export function createHelpdeskRepository(
  db: Database = getDb()
): HelpdeskRepository {
  return new DrizzleHelpdeskRepository(db)
}

class DrizzleHelpdeskRepository implements HelpdeskRepository {
  constructor(private readonly db: Database) {}

  async createRequest(input: CreateRequestRecordInput): Promise<RequestRecord> {
    const rows = await this.db
      .insert(helpdeskRequests)
      .values({
        requesterUserId: input.requesterUserId,
        requesterEmail: input.requesterEmail,
        title: input.title,
        description: input.description,
        severity: input.severity,
        linearIssueId: input.linearIssue.id,
        linearIdentifier: input.linearIssue.identifier,
        linearUrl: input.linearIssue.url,
        linearTeamId: input.linearTeamId,
        linearStateId: input.linearIssue.state.id,
        linearStateName: input.linearIssue.state.name,
        linearStateType: input.linearIssue.state.type,
        linearDetailsCommentId: input.linearIssue.detailsCommentId,
        linearDetailsCommentedAt: input.linearIssue.detailsCommentId
          ? new Date()
          : null,
      })
      .returning()
    const row = rows[0] as HelpdeskRequestRow | undefined

    if (!row) throw new Error("Failed to create helpdesk request")
    return toRequestRecord(row)
  }

  async listRequestsForUser(userId: string): Promise<RequestRecord[]> {
    const rows = await this.db
      .select()
      .from(helpdeskRequests)
      .where(eq(helpdeskRequests.requesterUserId, userId))
      .orderBy(desc(helpdeskRequests.createdAt))

    return rows.map(toRequestRecord)
  }

  async getRequestForUser(
    id: string,
    userId: string
  ): Promise<RequestRecord | null> {
    const rows = await this.db
      .select()
      .from(helpdeskRequests)
      .where(
        and(
          eq(helpdeskRequests.id, id),
          eq(helpdeskRequests.requesterUserId, userId)
        )
      )
      .limit(1)
    const row = rows[0] as HelpdeskRequestRow | undefined

    return row ? toRequestRecord(row) : null
  }

  async listRequestsMissingDetailsComment(
    limit: number
  ): Promise<RequestRecord[]> {
    const rows = await this.db
      .select()
      .from(helpdeskRequests)
      .where(isNull(helpdeskRequests.linearDetailsCommentId))
      .orderBy(desc(helpdeskRequests.createdAt))
      .limit(limit)

    return rows.map(toRequestRecord)
  }

  async markDetailsCommentCreated(
    id: string,
    commentId: string
  ): Promise<void> {
    const now = new Date()

    await this.db
      .update(helpdeskRequests)
      .set({
        linearDetailsCommentId: commentId,
        linearDetailsCommentedAt: now,
        updatedAt: now,
      })
      .where(eq(helpdeskRequests.id, id))
  }

  async hasProcessedWebhookEvent(eventKey: string): Promise<boolean> {
    const [row] = await this.db
      .select({ eventKey: linearWebhookEvents.eventKey })
      .from(linearWebhookEvents)
      .where(eq(linearWebhookEvents.eventKey, eventKey))
      .limit(1)

    return Boolean(row)
  }

  async recordWebhookEvent(
    eventKey: string,
    linearIssueId: string | null,
    rawBodyHash: string
  ): Promise<void> {
    await this.db
      .insert(linearWebhookEvents)
      .values({ eventKey, linearIssueId, rawBodyHash })
      .onConflictDoNothing()
  }

  async updateRequestFromLinear(
    snapshot: LinearIssueWebhookSnapshot
  ): Promise<void> {
    const now = new Date()

    await this.db
      .update(helpdeskRequests)
      .set({
        linearIdentifier: snapshot.linearIdentifier,
        linearUrl: snapshot.linearUrl,
        linearStateId: snapshot.linearStateId,
        linearStateName: snapshot.linearStateName,
        linearStateType: snapshot.linearStateType,
        lastLinearSyncedAt: now,
        updatedAt: now,
      })
      .where(eq(helpdeskRequests.linearIssueId, snapshot.linearIssueId))
  }
}

function toRequestRecord(row: HelpdeskRequestRow): RequestRecord {
  return {
    id: row.id,
    requesterUserId: row.requesterUserId,
    requesterEmail: row.requesterEmail,
    title: row.title,
    description: row.description,
    linearIssueId: row.linearIssueId,
    linearIdentifier: row.linearIdentifier,
    linearUrl: row.linearUrl,
    linearTeamId: row.linearTeamId,
    linearStateId: row.linearStateId,
    linearStateName: row.linearStateName,
    linearStateType: row.linearStateType,
    severity: row.severity,
    linearDetailsCommentId: row.linearDetailsCommentId,
    linearDetailsCommentedAt: row.linearDetailsCommentedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastLinearSyncedAt: row.lastLinearSyncedAt,
  }
}
