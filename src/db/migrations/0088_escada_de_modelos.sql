CREATE TABLE "task_model_escalations" (
	"task_id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"agent_id" text NOT NULL,
	"limit_blocks" integer DEFAULT 0 NOT NULL,
	"escalated" boolean DEFAULT false NOT NULL,
	"base_model_id" text,
	"base_routing_preference" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "model_escalation" jsonb;--> statement-breakpoint
ALTER TABLE "task_model_escalations" ADD CONSTRAINT "task_model_escalations_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_model_escalations" ADD CONSTRAINT "task_model_escalations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;