CREATE TYPE "public"."delegation_status" AS ENUM('completed', 'failed', 'dispensed');--> statement-breakpoint
CREATE TYPE "public"."failure_origin" AS ENUM('infra', 'modelo', 'codigo', 'politica');--> statement-breakpoint
CREATE TABLE "delegations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"area" text NOT NULL,
	"lead_agent" text NOT NULL,
	"subagent" text NOT NULL,
	"status" "delegation_status" NOT NULL,
	"parecer_artifact_id" text,
	"failure_origin" "failure_origin",
	"failure_reason" text,
	"justification" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delegations_completed_tem_parecer" CHECK ("delegations"."status" <> 'completed' or "delegations"."parecer_artifact_id" is not null),
	CONSTRAINT "delegations_failed_tem_origem" CHECK ("delegations"."status" <> 'failed' or "delegations"."failure_origin" is not null),
	CONSTRAINT "delegations_dispensed_tem_justificativa" CHECK ("delegations"."status" <> 'dispensed' or "delegations"."justification" is not null)
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "blocked_origin" "failure_origin";--> statement-breakpoint
ALTER TABLE "delegations" ADD CONSTRAINT "delegations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegations" ADD CONSTRAINT "delegations_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegations" ADD CONSTRAINT "delegations_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "delegations_task_idx" ON "delegations" USING btree ("task_id");