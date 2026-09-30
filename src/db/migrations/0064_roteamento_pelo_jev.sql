ALTER TABLE "workspaces" ADD COLUMN "tool_router_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "token_usage" ADD COLUMN "price_implicit" boolean DEFAULT false NOT NULL;