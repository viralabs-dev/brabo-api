-- AT-569 (ADR 0223): orcamento de raciocinio por modelo, curado a mao.
ALTER TABLE "models" ADD COLUMN "reasoning_budget" integer;--> statement-breakpoint
UPDATE "models" SET "reasoning_budget" = 2048 WHERE "provider"::text = 'openrouter' AND "name" = 'qwen/qwen3.7-flash';
