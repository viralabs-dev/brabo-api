ALTER TABLE "token_usage" ADD COLUMN "catalog_cost_micros" bigint;--> statement-breakpoint
ALTER TABLE "token_usage" ADD COLUMN "resolved_model_name" text;--> statement-breakpoint
ALTER TABLE "token_usage" ADD COLUMN "generation_id" text;