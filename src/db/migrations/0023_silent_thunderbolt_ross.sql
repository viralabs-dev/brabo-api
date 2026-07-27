CREATE TYPE "public"."account_token_purpose" AS ENUM('email_verification', 'password_reset', 'set_initial_password');--> statement-breakpoint
CREATE TYPE "public"."refresh_revoke_reason" AS ENUM('reuse_detected', 'logout', 'password_reset', 'family_max_age');--> statement-breakpoint
CREATE TABLE "account_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" "account_token_purpose" NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"invalidated_at" timestamp with time zone,
	"invalidated_reason" text,
	"requested_ip" text,
	"consumed_ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"password_hash" text NOT NULL,
	"password_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"email_verified_at" timestamp with time zone,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_credentials_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "auth_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"subject_key" text NOT NULL,
	"user_id" uuid,
	"ip" text,
	"user_agent" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_lockout_hits" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"bucket_key" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"family_started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rotated_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_reason" "refresh_revoke_reason",
	"issued_ip" text,
	"issued_user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "keycloak_sub" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "account_tokens" ADD CONSTRAINT "account_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_credentials" ADD CONSTRAINT "auth_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_tokens_hash_idx" ON "account_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "account_tokens_live_idx" ON "account_tokens" USING btree ("user_id","purpose") WHERE "account_tokens"."consumed_at" is null and "account_tokens"."invalidated_at" is null;--> statement-breakpoint
CREATE INDEX "account_tokens_expires_idx" ON "account_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "auth_events_subject_idx" ON "auth_events" USING btree ("subject_key","occurred_at");--> statement-breakpoint
CREATE INDEX "auth_events_kind_idx" ON "auth_events" USING btree ("kind","occurred_at");--> statement-breakpoint
CREATE INDEX "auth_events_occurred_idx" ON "auth_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "auth_lockout_hits_bucket_idx" ON "auth_lockout_hits" USING btree ("bucket_key","occurred_at");--> statement-breakpoint
CREATE INDEX "auth_lockout_hits_occurred_idx" ON "auth_lockout_hits" USING btree ("occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "refresh_tokens_hash_idx" ON "refresh_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "refresh_tokens_family_idx" ON "refresh_tokens" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "refresh_tokens_user_idx" ON "refresh_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "refresh_tokens_expires_idx" ON "refresh_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_idx" ON "users" USING btree (lower("email"));