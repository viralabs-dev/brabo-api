CREATE TYPE "public"."model_availability" AS ENUM('available', 'unavailable');--> statement-breakpoint
CREATE TYPE "public"."price_change_source" AS ENUM('manual', 'sync');--> statement-breakpoint
CREATE TABLE "model_price_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"model_id" uuid NOT NULL,
	"input_before_micros" bigint NOT NULL,
	"input_after_micros" bigint NOT NULL,
	"output_before_micros" bigint NOT NULL,
	"output_after_micros" bigint NOT NULL,
	"source" "price_change_source" NOT NULL,
	"changed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "models" ADD COLUMN "availability" "model_availability" DEFAULT 'available' NOT NULL;--> statement-breakpoint
ALTER TABLE "models" ADD COLUMN "last_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "token_usage" ADD COLUMN "input_price_per_million_micros" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "token_usage" ADD COLUMN "output_price_per_million_micros" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "model_price_changes" ADD CONSTRAINT "model_price_changes_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."models"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_price_changes" ADD CONSTRAINT "model_price_changes_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;