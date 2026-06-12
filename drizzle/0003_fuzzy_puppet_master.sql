ALTER TABLE "helpdesk_requests" ALTER COLUMN "requester_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "helpdesk_requests" ADD COLUMN "source" text DEFAULT 'web' NOT NULL;--> statement-breakpoint
ALTER TABLE "helpdesk_requests" ADD COLUMN "slack_channel_id" text;--> statement-breakpoint
ALTER TABLE "helpdesk_requests" ADD COLUMN "slack_message_ts" text;