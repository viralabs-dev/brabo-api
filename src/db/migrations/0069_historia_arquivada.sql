ALTER TABLE "stories" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "stories" ADD COLUMN "archived_reason" text;