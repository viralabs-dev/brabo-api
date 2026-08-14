CREATE TYPE "public"."project_workspace_mode" AS ENUM('container', 'local');--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "workspace_mode" "project_workspace_mode" DEFAULT 'container' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "workspace_path" text;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_workspace_path_casa_com_modo" CHECK (("projects"."workspace_mode" = 'local') = ("projects"."workspace_path" IS NOT NULL));