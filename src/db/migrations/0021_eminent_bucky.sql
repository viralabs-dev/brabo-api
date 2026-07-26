ALTER TABLE "outbox_events" ADD COLUMN "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "trace_parent" text;--> statement-breakpoint
CREATE INDEX "sessions_status_project_idx" ON "sessions" USING btree ("status","project_id");--> statement-breakpoint
CREATE INDEX "tasks_blocked_idx" ON "tasks" USING btree ("story_id") WHERE "tasks"."blocked";