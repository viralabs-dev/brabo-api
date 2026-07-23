-- Renomeia valores existentes em vez de recriar o enum (drizzle-kit gera um
-- DROP TYPE + CREATE TYPE + USING cast ingênuo, que quebra pra qualquer linha
-- já gravada com os valores antigos 'proposed'/'rejected'). RENAME VALUE
-- preserva o oid subjacente — linhas existentes continuam válidas.
ALTER TYPE "public"."action_status" RENAME VALUE 'proposed' TO 'pending';--> statement-breakpoint
ALTER TYPE "public"."action_status" RENAME VALUE 'rejected' TO 'denied';--> statement-breakpoint
ALTER TYPE "public"."action_status" ADD VALUE 'executed';--> statement-breakpoint
ALTER TYPE "public"."action_status" ADD VALUE 'failed';--> statement-breakpoint
CREATE TABLE "agent_autonomy" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"agent_id" text NOT NULL,
	"action_type" text NOT NULL,
	"mode" "permission_policy" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_autonomy_project_id_agent_id_action_type_unique" UNIQUE("project_id","agent_id","action_type")
);
--> statement-breakpoint
ALTER TABLE "proposed_actions" ADD COLUMN "execution_result" jsonb;--> statement-breakpoint
ALTER TABLE "agent_autonomy" ADD CONSTRAINT "agent_autonomy_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN "permissions";
