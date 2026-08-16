CREATE TYPE "public"."container_lifecycle_status" AS ENUM('provisioning', 'running', 'stopped', 'failed', 'removed');--> statement-breakpoint
CREATE TABLE "project_containers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"status" "container_lifecycle_status" DEFAULT 'provisioning' NOT NULL,
	"image_version" integer NOT NULL,
	"container_id" text,
	"cpus" double precision NOT NULL,
	"memory_mb" integer NOT NULL,
	"pids_limit" integer NOT NULL,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_containers_project_id_unique" UNIQUE("project_id")
);
--> statement-breakpoint
ALTER TABLE "project_containers" ADD CONSTRAINT "project_containers_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_containers_status_idx" ON "project_containers" USING btree ("status");