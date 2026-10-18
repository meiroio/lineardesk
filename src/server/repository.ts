import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  notInArray,
  sql,
} from "drizzle-orm"
import type { NodePgDatabase } from "drizzle-orm/node-postgres"

import type {
  ApplyWebhookEventInput,
  CreateRequestRecordInput,
  HelpdeskRepository,
  LinearIssueWebhookSnapshot,
  RequestListQuery,
  RequestRecord,
} from "./types"
import { getDb } from "./db/client"
import type * as schema from "./db/schema"
import {
  authUsers,
  helpdeskRequests,
  linearWebhookEvents,
  slackEvents,
} from "./db/schema"

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
        organizationId: input.organizationId,
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

  async listRequestsForOrganization(
    organizationId: string,
    query: RequestListQuery
  ) {
    const terminalStates = ["completed", "canceled", "duplicate"]
    const where = and(
      eq(helpdeskRequests.organizationId, organizationId),
      query.teamId
        ? eq(helpdeskRequests.linearTeamId, query.teamId)
        : undefined,
      query.status === "active"
        ? notInArray(helpdeskRequests.linearStateType, terminalStates)
        : query.status === "done"
          ? inArray(helpdeskRequests.linearStateType, terminalStates)
          : undefined,
      query.severity.length
        ? inArray(helpdeskRequests.severity, query.severity)
        : undefined
    )
    const [requests, [summary]] = await Promise.all([
      this.db
        .select({
          id: helpdeskRequests.id,
          title: helpdeskRequests.title,
          linearIdentifier: helpdeskRequests.linearIdentifier,
          linearStateName: helpdeskRequests.linearStateName,
          linearStateType: helpdeskRequests.linearStateType,
          severity: helpdeskRequests.severity,
          createdAt: helpdeskRequests.createdAt,
          updatedAt: helpdeskRequests.updatedAt,
        })
        .from(helpdeskRequests)
        .where(where)
        .orderBy(desc(helpdeskRequests.createdAt), desc(helpdeskRequests.id))
        .limit(query.pageSize)
        .offset(query.page * query.pageSize),
      this.db.select({ total: count() }).from(helpdeskRequests).where(where),
    ])
    return { requests, total: summary.total }
  }

  async listOpenRequests(limit: number) {
    return this.db
      .select({
        linearIssueId: helpdeskRequests.linearIssueId,
        linearStateId: helpdeskRequests.linearStateId,
      })
      .from(helpdeskRequests)
      .where(
        // Terminal states — mirrors TERMINAL_STATUS_TYPES in lib/helpdesk-api.
        notInArray(helpdeskRequests.linearStateType, [
          "completed",
          "canceled",
          "duplicate",
        ])
      )
      .orderBy(
        asc(helpdeskRequests.lastLinearSyncedAt),
        asc(helpdeskRequests.id)
      )
      .limit(limit)
  }

  async getRequestForOrganization(
    id: string,
    organizationId: string
  ): Promise<RequestRecord | null> {
    const rows = await this.db
      .select()
      .from(helpdeskRequests)
      .where(
        and(
          eq(helpdeskRequests.id, id),
          eq(helpdeskRequests.organizationId, organizationId)
        )
      )
      .limit(1)
    const row = rows[0] as HelpdeskRequestRow | undefined
    return row ? toRequestRecord(row) : null
  }

  async getRequestByLinearIssueId(
    linearIssueId: string
  ): Promise<RequestRecord | null> {
    const rows = await this.db
      .select()
      .from(helpdeskRequests)
      .where(eq(helpdeskRequests.linearIssueId, linearIssueId))
      .limit(1)
    const row = rows[0] as HelpdeskRequestRow | undefined
    return row ? toRequestRecord(row) : null
  }

  async markRequestsSynced(issueIds: string[], checkedAt: Date): Promise<void> {
    if (!issueIds.length) return
    await this.db
      .update(helpdeskRequests)
      // A concurrent webhook may already have recorded a later synchronization.
      .set({
        lastLinearSyncedAt: sql`greatest(${helpdeskRequests.lastLinearSyncedAt}, ${checkedAt.toISOString()}::timestamptz)`,
      })
      .where(inArray(helpdeskRequests.linearIssueId, issueIds))
  }

  async applyWebhookEvent({
    snapshot,
    ...event
  }: ApplyWebhookEventInput): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const claimed = await tx
        .insert(linearWebhookEvents)
        .values(event)
        .onConflictDoNothing()
        .returning({ eventKey: linearWebhookEvents.eventKey })
      if (!claimed.length) return false
      if (snapshot) await this.updateRequestFromLinear(snapshot, tx)
      return true
    })
  }

  async claimSlackEvent(eventId: string): Promise<boolean> {
    const [claimed] = await this.db
      .insert(slackEvents)
      .values({ eventId })
      .onConflictDoNothing()
      .returning({ eventId: slackEvents.eventId })
    return Boolean(claimed)
  }

  async releaseSlackEvent(eventId: string): Promise<void> {
    await this.db.delete(slackEvents).where(eq(slackEvents.eventId, eventId))
  }

  async updateRequestFields(input: {
    id: string
    title: string
    description: string
    severity: number
  }): Promise<RequestRecord | null> {
    const rows = await this.db
      .update(helpdeskRequests)
      .set({
        title: input.title,
        description: input.description,
        severity: input.severity,
        updatedAt: new Date(),
      })
      .where(eq(helpdeskRequests.id, input.id))
      .returning()
    const row = rows[0] as HelpdeskRequestRow | undefined
    return row ? toRequestRecord(row) : null
  }

  async updateRequestSeverity(input: {
    id: string
    severity: number
  }): Promise<RequestRecord | null> {
    const rows = await this.db
      .update(helpdeskRequests)
      .set({ severity: input.severity, updatedAt: new Date() })
      .where(eq(helpdeskRequests.id, input.id))
      .returning()
    const row = rows[0] as HelpdeskRequestRow | undefined
    return row ? toRequestRecord(row) : null
  }

  async updateRequestFromLinear(
    snapshot: LinearIssueWebhookSnapshot,
    db: Pick<Database, "update"> = this.db
  ): Promise<void> {
    const now = new Date()

    await db
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
    organizationId: row.organizationId,
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
