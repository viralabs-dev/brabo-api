CREATE TYPE "public"."backup_kind" AS ENUM('daily', 'weekly');--> statement-breakpoint
CREATE TYPE "public"."backup_status" AS ENUM('ok', 'failed');--> statement-breakpoint
CREATE TABLE "backup_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" "backup_kind" DEFAULT 'daily' NOT NULL,
	"status" "backup_status" NOT NULL,
	"object_key" text,
	"size_bytes" bigint DEFAULT 0 NOT NULL,
	"error_message" text
);
--> statement-breakpoint
CREATE TABLE "rate_limit_hits" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"bucket_key" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "backup_runs_last_success_idx" ON "backup_runs" USING btree ("finished_at") WHERE "backup_runs"."status" = 'ok';--> statement-breakpoint
CREATE INDEX "backup_runs_object_key_idx" ON "backup_runs" USING btree ("object_key");--> statement-breakpoint
CREATE INDEX "rate_limit_hits_bucket_idx" ON "rate_limit_hits" USING btree ("bucket_key","occurred_at");--> statement-breakpoint
CREATE INDEX "rate_limit_hits_occurred_idx" ON "rate_limit_hits" USING btree ("occurred_at");