-- AT-589 (ADR 0224): custo estimado de stream abortado, a reconciliar; limite do deepseek.
ALTER TABLE "token_usage" ADD COLUMN "custo_a_reconciliar" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "models" SET "reasoning_budget" = 2048 WHERE "provider"::text = 'openrouter' AND "name" = 'deepseek/deepseek-v4.1-flash';
