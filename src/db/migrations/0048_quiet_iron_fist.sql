CREATE TYPE "public"."project_execution_mode" AS ENUM('container', 'mounted', 'runner');--> statement-breakpoint
ALTER TABLE "projects" DROP CONSTRAINT "projects_workspace_path_casa_com_modo";--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "workspace_mode" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "workspace_mode" TYPE "public"."project_execution_mode"
  USING (CASE "workspace_mode"::text WHEN 'local' THEN 'mounted' ELSE "workspace_mode"::text END)::"public"."project_execution_mode";--> statement-breakpoint
ALTER TABLE "projects" RENAME COLUMN "workspace_mode" TO "execution_mode";--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "execution_mode" SET DEFAULT 'container';--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_workspace_path_casa_com_modo" CHECK (("projects"."execution_mode" <> 'container') = ("projects"."workspace_path" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "workspace_verified_at" timestamp with time zone;--> statement-breakpoint
DROP TYPE "public"."project_workspace_mode";
