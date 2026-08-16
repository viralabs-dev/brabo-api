CREATE TYPE "public"."social_identity_provider" AS ENUM('github', 'gitlab');--> statement-breakpoint
CREATE TABLE "social_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" "social_identity_provider" NOT NULL,
	"provider_user_id" text NOT NULL,
	"provider_email" text,
	"provider_login" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "social_identities" ADD CONSTRAINT "social_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "social_identities_provider_account_idx" ON "social_identities" USING btree ("provider","provider_user_id");--> statement-breakpoint
CREATE INDEX "social_identities_user_id_idx" ON "social_identities" USING btree ("user_id");