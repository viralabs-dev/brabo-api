ALTER TYPE "public"."task_status" ADD VALUE 'in_review' BEFORE 'done';--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "blocked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "blocked_reason" text;