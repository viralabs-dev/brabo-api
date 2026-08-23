ALTER TABLE "agent_areas" ADD COLUMN "budget_micros" bigint;--> statement-breakpoint
ALTER TABLE "agent_areas" ADD COLUMN "spent_micros" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_areas" ADD CONSTRAINT "agent_areas_budget_micros_check" CHECK ("agent_areas"."budget_micros" is null or "agent_areas"."budget_micros" >= 0);--> statement-breakpoint
ALTER TABLE "agent_areas" ADD CONSTRAINT "agent_areas_spent_micros_check" CHECK ("agent_areas"."spent_micros" >= 0);