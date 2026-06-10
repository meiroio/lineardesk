ALTER TABLE "helpdesk_requests" ADD COLUMN "linear_details_comment_id" text;--> statement-breakpoint
ALTER TABLE "helpdesk_requests" ADD COLUMN "linear_details_commented_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "helpdesk_requests_linear_details_comment_id_idx" ON "helpdesk_requests" USING btree ("linear_details_comment_id");