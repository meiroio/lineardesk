ALTER TABLE "invitation" ALTER COLUMN "expiresAt" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "metadata" text;