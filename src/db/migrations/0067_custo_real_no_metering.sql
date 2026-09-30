ALTER TABLE "token_usage" ADD COLUMN "catalog_cost_micros" bigint;--> statement-breakpoint
ALTER TABLE "token_usage" ADD COLUMN "resolved_model_name" text;--> statement-breakpoint
ALTER TABLE "token_usage" ADD COLUMN "generation_id" text;--> statement-breakpoint
ALTER TABLE "token_usage" ADD COLUMN "cached_input_tokens" integer;--> statement-breakpoint
ALTER TABLE "token_usage" ADD COLUMN "reasoning_tokens" integer;