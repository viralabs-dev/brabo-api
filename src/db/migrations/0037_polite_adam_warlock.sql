CREATE TABLE "agent_area_members" (
	"area_id" uuid NOT NULL,
	"agent_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_area_members_area_id_agent_id_pk" PRIMARY KEY("area_id","agent_id")
);
--> statement-breakpoint
CREATE TABLE "agent_areas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"key" text NOT NULL,
	"lead_agent_id" text NOT NULL,
	"max_parallel" integer DEFAULT 2 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_areas_project_id_key_unique" UNIQUE("project_id","key")
);
--> statement-breakpoint
ALTER TABLE "agent_area_members" ADD CONSTRAINT "agent_area_members_area_id_agent_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."agent_areas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_areas" ADD CONSTRAINT "agent_areas_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;