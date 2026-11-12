ALTER TABLE "budgets" DROP CONSTRAINT "budgets_scope_check";--> statement-breakpoint
ALTER TABLE "budgets" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
ALTER TABLE "budgets" ADD COLUMN "periodo_inicio" date;--> statement-breakpoint
ALTER TABLE "agent_areas" ADD COLUMN "periodo_inicio" date;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_workspace_id_unique" UNIQUE("workspace_id");--> statement-breakpoint
-- ADR 0296: o teto de projeto e o de área passam a ser mensais (mês UTC). O gasto
-- vira a soma REAL do mês corrente em token_usage (todos os atores, como o
-- incrementSpent soma); sessão apagada leva o token_usage junto, então o
-- recálculo pode ficar abaixo do real. O limiar já cruzado não é reavisado.
UPDATE "budgets" b SET
  "periodo_inicio" = (date_trunc('month', now() at time zone 'UTC'))::date,
  "spent_micros" = COALESCE((
    SELECT sum(t."cost_micros") FROM "token_usage" t
    JOIN "sessions" s ON s."id" = t."session_id"
    WHERE s."project_id" = b."project_id"
      AND t."created_at" >= (date_trunc('month', now() at time zone 'UTC')) at time zone 'UTC'
  ), 0)
WHERE b."project_id" IS NOT NULL;--> statement-breakpoint
-- Mapa ator -> área congelado aqui (espelha src/domain/agents/agent-areas.ts):
-- dev-lead e dev-* -> dev; qa, qa-automacao, qa-performance-seguranca -> qa; infra, infra-workflows -> infra.
UPDATE "agent_areas" a SET
  "periodo_inicio" = (date_trunc('month', now() at time zone 'UTC'))::date,
  "spent_micros" = COALESCE((
    SELECT sum(t."cost_micros") FROM "token_usage" t
    JOIN "sessions" s ON s."id" = t."session_id"
    WHERE s."project_id" = a."project_id"
      AND t."actor_kind" = 'agent'
      AND t."created_at" >= (date_trunc('month', now() at time zone 'UTC')) at time zone 'UTC'
      AND CASE
        WHEN t."actor_id" LIKE 'dev-%' THEN 'dev'
        WHEN t."actor_id" IN ('qa', 'qa-automacao', 'qa-performance-seguranca') THEN 'qa'
        WHEN t."actor_id" IN ('infra', 'infra-workflows') THEN 'infra'
      END = a."key"
  ), 0);--> statement-breakpoint
UPDATE "budgets" SET "last_threshold_notified" = CASE
  WHEN "limit_micros" <= 0 THEN 0
  WHEN "spent_micros" >= "limit_micros" THEN 100
  WHEN "spent_micros" * 100 >= "limit_micros" * 90 THEN 90
  WHEN "spent_micros" * 100 >= "limit_micros" * 70 THEN 70
  ELSE 0 END
WHERE "project_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_periodo_check" CHECK (("budgets"."session_id" is null) or ("budgets"."periodo_inicio" is null));--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_scope_check" CHECK (num_nonnulls("budgets"."project_id", "budgets"."session_id", "budgets"."workspace_id") = 1);
