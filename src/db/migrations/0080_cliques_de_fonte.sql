CREATE TABLE "source_clicks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"session_id" uuid,
	"event_id" uuid NOT NULL,
	"tipo" text NOT NULL,
	"ref" text,
	"search_id" uuid,
	"chunk_id" uuid,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "source_clicks" ADD CONSTRAINT "source_clicks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "source_clicks_project_created_idx" ON "source_clicks" USING btree ("project_id","created_at");