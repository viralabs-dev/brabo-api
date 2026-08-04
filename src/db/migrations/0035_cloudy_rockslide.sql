ALTER TABLE "models" ADD COLUMN "supports_reasoning" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "models" ADD COLUMN "generates_image" boolean DEFAULT false NOT NULL;