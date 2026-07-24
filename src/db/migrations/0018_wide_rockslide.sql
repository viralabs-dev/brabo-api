CREATE TABLE "agent_instruction_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"agent" text NOT NULL,
	"version" integer NOT NULL,
	"content" text NOT NULL,
	"created_by" uuid,
	"source_action_id" uuid,
	"source_hypothesis_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_instruction_versions_project_id_agent_version_unique" UNIQUE("project_id","agent","version")
);
--> statement-breakpoint
CREATE TABLE "anamnese_opt_outs" (
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"opted_out_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "anamnese_opt_outs_project_id_user_id_pk" PRIMARY KEY("project_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "anamnese_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"origin" text DEFAULT 'hypothesis' NOT NULL,
	"hypothesis_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"consumed_at" timestamp with time zone,
	CONSTRAINT "anamnese_queue_hypothesis_id_unique" UNIQUE("hypothesis_id")
);
--> statement-breakpoint
CREATE TABLE "anamnese_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"window_from" timestamp with time zone NOT NULL,
	"window_to" timestamp with time zone NOT NULL,
	"event_count" integer NOT NULL,
	"profile_count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proficiency_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"competency" text NOT NULL,
	"level" text NOT NULL,
	"rationale" text NOT NULL,
	"evidence_event_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "proficiency_profiles_project_id_user_id_competency_unique" UNIQUE("project_id","user_id","competency")
);
--> statement-breakpoint
ALTER TABLE "agent_instruction_versions" ADD CONSTRAINT "agent_instruction_versions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_instruction_versions" ADD CONSTRAINT "agent_instruction_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anamnese_opt_outs" ADD CONSTRAINT "anamnese_opt_outs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anamnese_opt_outs" ADD CONSTRAINT "anamnese_opt_outs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anamnese_queue" ADD CONSTRAINT "anamnese_queue_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anamnese_queue" ADD CONSTRAINT "anamnese_queue_hypothesis_id_psychologist_hypotheses_id_fk" FOREIGN KEY ("hypothesis_id") REFERENCES "public"."psychologist_hypotheses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anamnese_runs" ADD CONSTRAINT "anamnese_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anamnese_runs" ADD CONSTRAINT "anamnese_runs_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proficiency_profiles" ADD CONSTRAINT "proficiency_profiles_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proficiency_profiles" ADD CONSTRAINT "proficiency_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_instruction_versions_agent_idx" ON "agent_instruction_versions" USING btree ("project_id","agent");--> statement-breakpoint
CREATE INDEX "anamnese_queue_project_idx" ON "anamnese_queue" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "anamnese_runs_project_idx" ON "anamnese_runs" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "proficiency_profiles_project_idx" ON "proficiency_profiles" USING btree ("project_id");