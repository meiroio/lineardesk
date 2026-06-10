import { relations } from "drizzle-orm"
import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core"

export const authUsers = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("emailVerified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("createdAt", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updatedAt", { withTimezone: true })
    .notNull()
    .defaultNow(),
})

export const authSessions = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expiresAt", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .notNull()
      .defaultNow(),
    ipAddress: text("ipAddress"),
    userAgent: text("userAgent"),
    userId: text("userId")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_userId_idx").on(table.userId)]
)

export const authAccounts = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("accountId").notNull(),
    providerId: text("providerId").notNull(),
    userId: text("userId")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    accessToken: text("accessToken"),
    refreshToken: text("refreshToken"),
    idToken: text("idToken"),
    accessTokenExpiresAt: timestamp("accessTokenExpiresAt", {
      withTimezone: true,
    }),
    refreshTokenExpiresAt: timestamp("refreshTokenExpiresAt", {
      withTimezone: true,
    }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("account_userId_idx").on(table.userId)]
)

export const authVerifications = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expiresAt", { withTimezone: true }).notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)]
)

export const helpdeskRequests = pgTable(
  "helpdesk_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    requesterUserId: text("requester_user_id").notNull(),
    requesterEmail: text("requester_email").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    linearIssueId: text("linear_issue_id").notNull().unique(),
    linearIdentifier: text("linear_identifier").notNull(),
    linearUrl: text("linear_url").notNull(),
    linearTeamId: text("linear_team_id").notNull(),
    linearStateId: text("linear_state_id").notNull(),
    linearStateName: text("linear_state_name").notNull(),
    linearStateType: text("linear_state_type").notNull(),
    linearDetailsCommentId: text("linear_details_comment_id"),
    linearDetailsCommentedAt: timestamp("linear_details_commented_at", {
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastLinearSyncedAt: timestamp("last_linear_synced_at", {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("helpdesk_requests_requester_user_id_idx").on(table.requesterUserId),
    index("helpdesk_requests_linear_issue_id_idx").on(table.linearIssueId),
    index("helpdesk_requests_linear_details_comment_id_idx").on(
      table.linearDetailsCommentId
    ),
  ]
)

export const linearWebhookEvents = pgTable("linear_webhook_events", {
  eventKey: text("event_key").primaryKey(),
  linearIssueId: text("linear_issue_id"),
  rawBodyHash: text("raw_body_hash").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
})

export const authUsersRelations = relations(authUsers, ({ many }) => ({
  sessions: many(authSessions),
  accounts: many(authAccounts),
}))

export const authSessionsRelations = relations(authSessions, ({ one }) => ({
  user: one(authUsers, {
    fields: [authSessions.userId],
    references: [authUsers.id],
  }),
}))

export const authAccountsRelations = relations(authAccounts, ({ one }) => ({
  user: one(authUsers, {
    fields: [authAccounts.userId],
    references: [authUsers.id],
  }),
}))
