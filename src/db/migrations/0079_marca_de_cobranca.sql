CREATE TYPE "public"."model_billing" AS ENUM('api', 'subscription', 'free');--> statement-breakpoint
ALTER TABLE "models" ADD COLUMN "billing" "model_billing" DEFAULT 'api' NOT NULL;