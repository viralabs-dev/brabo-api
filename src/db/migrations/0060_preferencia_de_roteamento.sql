CREATE TYPE "public"."routing_preference" AS ENUM('price', 'throughput', 'latency');--> statement-breakpoint
ALTER TABLE "model_bindings" ADD COLUMN "routing_preference" "routing_preference";--> statement-breakpoint
ALTER TABLE "token_usage" ADD COLUMN "routing_preference" "routing_preference";