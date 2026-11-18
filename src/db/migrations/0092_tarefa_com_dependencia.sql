ALTER TABLE "tasks" ADD COLUMN "levantamento" jsonb;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "depende_de" uuid[] DEFAULT '{}'::uuid[] NOT NULL;