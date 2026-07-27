CREATE TYPE "public"."task_status" AS ENUM('todo', 'in_progress', 'done');--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "status" "task_status" DEFAULT 'todo' NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "assigned_to" text;