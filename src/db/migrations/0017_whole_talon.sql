CREATE TABLE "psychologist_analyses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"tier" text NOT NULL,
	"triggered_by" text DEFAULT 'auto' NOT NULL,
	"supersedes" uuid,
	"superseded" boolean DEFAULT false NOT NULL,
	"event_count_at_analysis" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "psychologist_hypotheses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"analysis_id" uuid NOT NULL,
	"agente_alvo" text NOT NULL,
	"observacao" text NOT NULL,
	"hipotese" text NOT NULL,
	"sugestao" text NOT NULL,
	"confianca_percent" integer NOT NULL,
	"evidence_event_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"termination_analysis" jsonb,
	"status" text DEFAULT 'proposed' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "termination_reason" text;--> statement-breakpoint
ALTER TABLE "psychologist_analyses" ADD CONSTRAINT "psychologist_analyses_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "psychologist_analyses" ADD CONSTRAINT "psychologist_analyses_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "psychologist_hypotheses" ADD CONSTRAINT "psychologist_hypotheses_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "psychologist_hypotheses" ADD CONSTRAINT "psychologist_hypotheses_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "psychologist_hypotheses" ADD CONSTRAINT "psychologist_hypotheses_analysis_id_psychologist_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."psychologist_analyses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "psychologist_hypotheses" ADD CONSTRAINT "psychologist_hypotheses_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "psychologist_analyses_current_idx" ON "psychologist_analyses" USING btree ("session_id") WHERE "psychologist_analyses"."superseded" = false;--> statement-breakpoint
CREATE INDEX "psychologist_hypotheses_project_idx" ON "psychologist_hypotheses" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "psychologist_hypotheses_analysis_idx" ON "psychologist_hypotheses" USING btree ("analysis_id");