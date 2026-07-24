CREATE TYPE "public"."bootstrap_status" AS ENUM('pending', 'running', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."bootstrap_step" AS ENUM('create_dev_branch', 'create_qa_branch', 'create_rc_branch', 'protect_branches', 'commit_pr_template', 'commit_branching_policy');--> statement-breakpoint
CREATE TABLE "repo_bootstraps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"step" "bootstrap_step" DEFAULT 'create_dev_branch' NOT NULL,
	"status" "bootstrap_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repo_bootstraps_project_id_unique" UNIQUE("project_id")
);
--> statement-breakpoint
ALTER TABLE "repo_bootstraps" ADD CONSTRAINT "repo_bootstraps_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repo_bootstraps" ADD CONSTRAINT "repo_bootstraps_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;