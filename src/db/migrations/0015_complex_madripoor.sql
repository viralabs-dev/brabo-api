ALTER TABLE "tasks" ADD COLUMN "gate_status" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "gate_correction_count" integer DEFAULT 0 NOT NULL;