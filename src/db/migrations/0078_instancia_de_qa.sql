CREATE TYPE "public"."qa_environment_status" AS ENUM('provisioning', 'running', 'failed', 'removed');--> statement-breakpoint
CREATE TABLE "project_qa_environments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"status" "qa_environment_status" DEFAULT 'provisioning' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_qa_environments_project_task_uq" UNIQUE("project_id","task_id")
);
--> statement-breakpoint
ALTER TABLE "project_qa_environments" ADD CONSTRAINT "project_qa_environments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_qa_environments_one_active_idx" ON "project_qa_environments" USING btree ("project_id") WHERE "project_qa_environments"."status" in ('provisioning', 'running');