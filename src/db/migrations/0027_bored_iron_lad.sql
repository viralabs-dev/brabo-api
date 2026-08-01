ALTER TABLE "models" ADD COLUMN "manual_pricing" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "token_usage" ADD COLUMN "upstream_provider" text;