DROP INDEX "helpdesk_requests_organization_id_idx";--> statement-breakpoint
DROP INDEX "helpdesk_requests_linear_issue_id_idx";--> statement-breakpoint
CREATE INDEX "helpdesk_requests_organization_created_idx" ON "helpdesk_requests" USING btree ("organization_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "helpdesk_requests_open_sync_idx" ON "helpdesk_requests" USING btree ("last_linear_synced_at","id") WHERE "helpdesk_requests"."linear_state_type" not in ('completed', 'canceled', 'duplicate');