CREATE TYPE "public"."bootstrap_plan_decision" AS ENUM('approved', 'as_is');--> statement-breakpoint
CREATE TYPE "public"."repo_origin" AS ENUM('created', 'adopted');--> statement-breakpoint
-- O `DEFAULT 'created' NOT NULL` É o backfill (Fase 12a — RN-046), e aqui ele
-- pode ser cego, ao contrário do backfill dirigido da 0026: adoção não existia
-- antes desta migração, então TODA linha pré-existente foi, por definição,
-- criada pelo Brabo. Não há linha adotada para classificar errado.
ALTER TABLE "project_repositories" ADD COLUMN "origin" "repo_origin" DEFAULT 'created' NOT NULL;--> statement-breakpoint
ALTER TABLE "repo_bootstraps" ADD COLUMN "origin" "repo_origin" DEFAULT 'created' NOT NULL;--> statement-breakpoint
ALTER TABLE "repo_bootstraps" ADD COLUMN "plan" jsonb;--> statement-breakpoint
ALTER TABLE "repo_bootstraps" ADD COLUMN "plan_generated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "repo_bootstraps" ADD COLUMN "plan_decision" "bootstrap_plan_decision";--> statement-breakpoint
ALTER TABLE "repo_bootstraps" ADD COLUMN "plan_decided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "repo_bootstraps" ADD COLUMN "plan_decided_by" uuid;--> statement-breakpoint
ALTER TABLE "repo_bootstraps" ADD CONSTRAINT "repo_bootstraps_plan_decided_by_users_id_fk" FOREIGN KEY ("plan_decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;