CREATE TABLE "project_mirror_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"last_synced_at" timestamp with time zone,
	"files_copied" integer,
	"files_skipped" integer,
	"files_refused" integer,
	"destination" text,
	"last_error_at" timestamp with time zone,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_mirror_states_project_id_unique" UNIQUE("project_id")
);
--> statement-breakpoint
ALTER TABLE "project_mirror_states" ADD CONSTRAINT "project_mirror_states_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;