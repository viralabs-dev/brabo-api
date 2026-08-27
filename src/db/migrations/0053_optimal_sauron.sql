CREATE TYPE "public"."huggingface_model_pull_status" AS ENUM('pending_confirmation', 'confirmed', 'pulling', 'active', 'failed');--> statement-breakpoint
CREATE TABLE "huggingface_model_pull_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"repo_id" text NOT NULL,
	"estimated_size_bytes" bigint,
	"status" "huggingface_model_pull_status" DEFAULT 'pending_confirmation' NOT NULL,
	"confirmed_at" timestamp with time zone,
	"failed_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "huggingface_model_pull_requests" ADD CONSTRAINT "huggingface_model_pull_requests_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "huggingface_model_pull_requests" ADD CONSTRAINT "huggingface_model_pull_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "huggingface_pull_requests_workspace_idx" ON "huggingface_model_pull_requests" USING btree ("workspace_id");