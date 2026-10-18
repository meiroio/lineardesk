import { randomUUID } from "node:crypto"
import process from "node:process"
import { fileURLToPath } from "node:url"

import { drizzle } from "drizzle-orm/node-postgres"
import { migrate } from "drizzle-orm/node-postgres/migrator"
import { Pool } from "pg"
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"

import * as schema from "../db/schema"
import { reconcileOpenRequests } from "../reconcile"
import { createHelpdeskRepository } from "../repository"
import type { HelpdeskRepository, LinearGateway } from "../types"

// Opt in with a PostgreSQL role allowed to CREATE DATABASE. The supplied
// database is only a maintenance connection; fixtures live in a fresh database.
const databaseUrl = process.env.LINEARDESK_TEST_DATABASE_URL

describe.skipIf(!databaseUrl)("PostgreSQL repository integration", () => {
  const databaseName = `lineardesk_test_${randomUUID().replaceAll("-", "")}`
  let maintenance: Pool | undefined
  let pool: Pool
  let repo: HelpdeskRepository
  let created = false

  beforeAll(async () => {
    maintenance = new Pool({ connectionString: databaseUrl })
    await maintenance.query(`CREATE DATABASE "${databaseName}"`)
    created = true
    const url = new URL(databaseUrl!)
    url.pathname = `/${databaseName}`
    pool = new Pool({ connectionString: url.toString(), max: 12 })
    expect(
      (await pool.query("SELECT current_database() AS name")).rows[0].name
    ).toBe(databaseName)
    const db = drizzle(pool, { schema })
    await migrate(db, {
      migrationsFolder: fileURLToPath(
        new URL("../../../drizzle", import.meta.url)
      ),
    })
    repo = createHelpdeskRepository(db)
  })

  afterAll(async () => {
    if (typeof pool !== "undefined") await pool.end()
    if (created) await maintenance?.query(`DROP DATABASE "${databaseName}"`)
    await maintenance?.end()
  })

  beforeEach(async () => {
    await pool.query(
      "TRUNCATE helpdesk_requests, linear_webhook_events, slack_events"
    )
    await pool.query('DELETE FROM "organization"')
  })

  async function seedRequests(organizationId: string, count: number) {
    await pool.query(
      'INSERT INTO "organization" (id, name, slug) VALUES ($1, $1, $1)',
      [organizationId]
    )
    await pool.query(
      `
      INSERT INTO helpdesk_requests (
        organization_id, requester_email, title, description, severity,
        linear_issue_id, linear_identifier, linear_url, linear_team_id,
        linear_state_id, linear_state_name, linear_state_type,
        created_at, updated_at, last_linear_synced_at
      )
      SELECT $1, 'requester@example.com', 'Ticket ' || i, repeat('x', 8000), i % 4 + 1,
        $1 || '-' || i, $1 || '-' || i, 'https://linear.app/issue/' || i, 'team',
        CASE WHEN i % 3 = 0 THEN 'done' ELSE 'triage' END,
        CASE WHEN i % 3 = 0 THEN 'Done' ELSE 'Triage' END,
        CASE WHEN i % 3 = 0 THEN 'completed' ELSE 'triage' END,
        '2020-01-01'::timestamptz + (i / 2) * interval '1 second',
        '2020-01-01'::timestamptz + (i / 2) * interval '1 second',
        '2020-01-01'::timestamptz + i * interval '1 second'
      FROM generate_series(1, $2::integer) AS i
    `,
      [organizationId, count]
    )
  }

  it("filters teams before pagination and counting while preserving organization isolation", async () => {
    await seedRequests("org-a", 24)
    await seedRequests("org-b", 8)
    await pool.query(
      "UPDATE helpdesk_requests SET linear_team_id = 'team-product' WHERE linear_issue_id IN ('org-a-1', 'org-a-23', 'org-b-5')"
    )
    const query = {
      page: 0,
      pageSize: 1,
      status: "all" as const,
      severity: [],
      teamId: "team-product",
    }
    const first = await repo.listRequestsForOrganization("org-a", query)
    const second = await repo.listRequestsForOrganization("org-a", {
      ...query,
      page: 1,
    })
    expect(first.total).toBe(2)
    expect(first.requests).toHaveLength(1)
    expect(second.total).toBe(2)
    expect(second.requests).toHaveLength(1)
    expect(
      [...first.requests, ...second.requests].map(
        (request) => request.linearIdentifier
      )
    ).toEqual(["org-a-23", "org-a-1"])
    expect(
      await repo.listRequestsForOrganization("org-a", {
        ...query,
        teamId: "unknown-team",
      })
    ).toEqual({ requests: [], total: 0 })
  })

  it("keeps the unique issue constraint while installing the ordered maintenance indexes", async () => {
    const { rows } = await pool.query<{ indexname: string; indexdef: string }>(
      "SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'helpdesk_requests'"
    )
    const indexes = new Map(rows.map((row) => [row.indexname, row.indexdef]))
    expect(indexes.get("helpdesk_requests_linear_issue_id_unique")).toContain(
      "CREATE UNIQUE INDEX"
    )
    expect(indexes.has("helpdesk_requests_linear_issue_id_idx")).toBe(false)
    expect(indexes.has("helpdesk_requests_organization_id_idx")).toBe(false)
    expect(indexes.has("helpdesk_requests_organization_created_idx")).toBe(true)
    expect(indexes.has("helpdesk_requests_open_sync_idx")).toBe(true)
    const constraints = await pool.query(
      "SELECT conname FROM pg_constraint WHERE conrelid = 'helpdesk_requests'::regclass AND contype = 'u'"
    )
    expect(constraints.rows.map((row) => row.conname)).toContain(
      "helpdesk_requests_linear_issue_id_unique"
    )
  })

  it("does not backdate a synchronization newer than the reconciliation start", async () => {
    await seedRequests("sync", 1)
    const newer = new Date("2026-09-08T12:00:00Z")
    await pool.query(
      "UPDATE helpdesk_requests SET last_linear_synced_at = $1",
      [newer]
    )
    const before = await repo.getRequestByLinearIssueId("sync-1")

    await repo.markRequestsSynced(["sync-1"], new Date("2026-09-08T11:00:00Z"))

    const after = await repo.getRequestByLinearIssueId("sync-1")
    expect(after?.lastLinearSyncedAt).toEqual(newer)
    expect(after?.updatedAt).toEqual(before?.updatedAt)
  })

  it("gives concurrent Slack deliveries one claim and allows a released claim to retry", async () => {
    const claims = await Promise.all(
      Array.from({ length: 8 }, () => repo.claimSlackEvent("slack-event"))
    )
    expect(claims.filter(Boolean)).toHaveLength(1)
    expect(
      (await pool.query("SELECT count(*)::int AS count FROM slack_events"))
        .rows[0].count
    ).toBe(1)

    await repo.releaseSlackEvent("slack-event")
    await expect(repo.claimSlackEvent("slack-event")).resolves.toBe(true)
    await expect(repo.claimSlackEvent("slack-event")).resolves.toBe(false)
  })

  it("claims a webhook and updates its snapshot atomically, rolling back a failed update", async () => {
    await seedRequests("webhook", 1)
    const event = {
      eventKey: "linear-event",
      linearIssueId: "webhook-1",
      rawBodyHash: "hash",
      snapshot: {
        linearIssueId: "webhook-1",
        linearIdentifier: "DESK-1",
        linearUrl: "https://linear.app/issue/1",
        linearStateId: "done",
        linearStateName: "Done",
        linearStateType: "completed",
      },
    }
    const claims = await Promise.all(
      Array.from({ length: 8 }, () => repo.applyWebhookEvent(event))
    )
    expect(claims.filter(Boolean)).toHaveLength(1)
    expect(
      (await repo.getRequestByLinearIssueId("webhook-1"))?.linearStateId
    ).toBe("done")
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS count FROM linear_webhook_events"
        )
      ).rows[0].count
    ).toBe(1)

    await pool.query(
      "ALTER TABLE helpdesk_requests ADD CONSTRAINT reject_test_state CHECK (linear_state_id <> 'force-failure')"
    )
    const failed = {
      ...event,
      eventKey: "failed-event",
      snapshot: { ...event.snapshot, linearStateId: "force-failure" },
    }
    await expect(repo.applyWebhookEvent(failed)).rejects.toThrow()
    expect(
      (
        await pool.query(
          "SELECT event_key FROM linear_webhook_events WHERE event_key = $1",
          [failed.eventKey]
        )
      ).rows
    ).toEqual([])
    expect(
      (await repo.getRequestByLinearIssueId("webhook-1"))?.linearStateId
    ).toBe("done")
    await pool.query(
      "ALTER TABLE helpdesk_requests DROP CONSTRAINT reject_test_state"
    )
    await expect(repo.applyWebhookEvent(failed)).resolves.toBe(true)
  })

  it("pages summary fields with tenant isolation, filtered totals, and stable ordering across 1500 requests", async () => {
    await seedRequests("org-a", 1200)
    await seedRequests("org-b", 300)
    const query = {
      page: 0,
      pageSize: 50,
      status: "all" as const,
      severity: [],
    }
    const first = await repo.listRequestsForOrganization("org-a", query)
    const second = await repo.listRequestsForOrganization("org-a", {
      ...query,
      page: 1,
    })
    expect(first.total).toBe(1200)
    expect(first.requests).toHaveLength(50)
    expect(second.requests).toHaveLength(50)
    const both = [...first.requests, ...second.requests]
    expect(new Set(both.map((request) => request.id)).size).toBe(100)
    expect(
      both.every((request) => request.linearIdentifier.startsWith("org-a-"))
    ).toBe(true)
    expect(Object.keys(first.requests[0]).sort()).toEqual([
      "createdAt",
      "id",
      "linearIdentifier",
      "linearStateName",
      "linearStateType",
      "severity",
      "title",
      "updatedAt",
    ])
    expect(both).toEqual(
      [...both].sort(
        (left, right) =>
          right.createdAt.getTime() - left.createdAt.getTime() ||
          right.id.localeCompare(left.id)
      )
    )

    const active = await repo.listRequestsForOrganization("org-a", {
      ...query,
      status: "active",
      severity: [1, 3],
    })
    expect(active.total).toBe(400)
    expect(
      active.requests.every(
        (request) =>
          request.linearStateType === "triage" &&
          [1, 3].includes(request.severity!)
      )
    ).toBe(true)
    const done = await repo.listRequestsForOrganization("org-a", {
      ...query,
      status: "done",
      severity: [2],
    })
    expect(done.total).toBe(100)
    expect(
      done.requests.every(
        (request) =>
          request.linearStateType === "completed" && request.severity === 2
      )
    ).toBe(true)
    await expect(
      repo.listRequestsForOrganization("org-a", { ...query, page: 24 })
    ).resolves.toEqual({ requests: [], total: 1200 })
  })

  it("rotates reconciliation beyond 200 unchanged tickets without changing their updatedAt", async () => {
    await seedRequests("reconcile", 401)
    await pool.query(`UPDATE helpdesk_requests SET
      linear_state_id = 'triage', linear_state_name = 'Triage', linear_state_type = 'triage',
      last_linear_synced_at = '2020-01-02'::timestamptz - substring(linear_issue_id from '[0-9]+$')::int * interval '1 second'`)
    const before = await pool.query(
      "SELECT linear_issue_id, updated_at FROM helpdesk_requests"
    )
    const checked = new Set<string>()
    const listIssueStates = vi.fn(async (ids: string[]) =>
      ids.map((id) => {
        checked.add(id)
        return {
          id,
          identifier: id,
          url: `https://linear.app/issue/${id}`,
          state:
            id === "reconcile-1"
              ? { id: "done", name: "Done", type: "completed" }
              : { id: "triage", name: "Triage", type: "triage" },
        }
      })
    )
    const linear = { listIssueStates } as unknown as LinearGateway
    const results = []
    for (let pass = 0; pass < 3; pass++)
      results.push(await reconcileOpenRequests({ repo, linear, limit: 200 }))

    expect(results.map((result) => result.updated)).toEqual([0, 0, 1])
    expect(checked.size).toBe(401)
    expect(listIssueStates.mock.calls.every(([ids]) => ids.length <= 200)).toBe(
      true
    )
    expect(
      (await repo.getRequestByLinearIssueId("reconcile-1"))?.linearStateId
    ).toBe("done")
    const after = await pool.query(
      "SELECT linear_issue_id, updated_at, last_linear_synced_at FROM helpdesk_requests"
    )
    const originalUpdatedAt = new Map(
      before.rows.map((row) => [row.linear_issue_id, row.updated_at])
    )
    for (const row of after.rows) {
      if (row.linear_issue_id !== "reconcile-1")
        expect(row.updated_at).toEqual(
          originalUpdatedAt.get(row.linear_issue_id)
        )
      expect(row.last_linear_synced_at.getTime()).toBeGreaterThan(
        new Date("2020-01-02").getTime()
      )
    }
  })
})
