import { and, desc, eq, notInArray } from "drizzle-orm"
import type { NodePgDatabase } from "drizzle-orm/node-postgres"

import type {
  CreateRequestRecordInput,
  HelpdeskRepository,
  LinearIssueWebhookSnapshot,
  RequestRecord,
} from "./types"
import { getDb } from "./db/client"
import type * as schema from "./db/schema"
import { authUsers, helpdeskRequests, linearWebhookEvents } from "./db/schema"

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
        source: input.source ?? "web",
        slackChannelId: input.slackChannelId ?? null,
        slackMessageTs: input.slackMessageTs ?? null,
      })
      .returning()
    const row = rows[0] as HelpdeskRequestRow | undefined

    if (!row) throw new Error("Failed to create helpdesk request")
    return toRequestRecord(row)
  }

  async getUserIdByEmail(email: string): Promise<string | null> {
    const rows = await this.db
      .select({ id: authUsers.id })
      .from(authUsers)
      .where(eq(authUsers.email, email))
      .limit(1)
    return rows[0]?.id ?? null
  }

  async listRequestsForEmail(email: string): Promise<RequestRecord[]> {
    const rows = await this.db
      .select()
      .from(helpdeskRequests)
      .where(eq(helpdeskRequests.requesterEmail, email))
      .orderBy(desc(helpdeskRequests.createdAt))
    return rows.map(toRequestRecord)
  }

  async listOpenRequests(limit: number): Promise<RequestRecord[]> {
    const rows = await this.db
      .select()
      .from(helpdeskRequests)
      .where(
        // Terminal states — mirrors TERMINAL_STATUS_TYPES in lib/helpdesk-api.
        notInArray(helpdeskRequests.linearStateType, [
          "completed",
          "canceled",
          "duplicate",
        ])
      )
      .orderBy(desc(helpdeskRequests.updatedAt))
      .limit(limit)

    return rows.map(toRequestRecord)
  }

  async getRequestForEmail(
    id: string,
    email: string
  ): Promise<RequestRecord | null> {
    const rows = await this.db
      .select()
      .from(helpdeskRequests)
      .where(
        and(
          eq(helpdeskRequests.id, id),
          eq(helpdeskRequests.requesterEmail, email)
        )
      )
      .limit(1)
    const row = rows[0] as HelpdeskRequestRow | undefined
    return row ? toRequestRecord(row) : null
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

export function toRequestRecord(row: HelpdeskRequestRow): RequestRecord {
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
    source: row.source === "slack" ? "slack" : "web",
    slackChannelId: row.slackChannelId,
    slackMessageTs: row.slackMessageTs,
  }
}
