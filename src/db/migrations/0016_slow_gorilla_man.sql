CREATE TABLE "infra_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"title" text NOT NULL,
	"pr_action_id" uuid NOT NULL,
	"gate_status" text DEFAULT 'awaiting_qa' NOT NULL,
	"gate_correction_count" integer DEFAULT 0 NOT NULL,
	"blocked" boolean DEFAULT false NOT NULL,
	"blocked_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "infra_artifacts" ADD CONSTRAINT "infra_artifacts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "infra_artifacts" ADD CONSTRAINT "infra_artifacts_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "infra_artifacts_project_idx" ON "infra_artifacts" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "infra_artifacts_pr_action_idx" ON "infra_artifacts" USING btree ("pr_action_id");