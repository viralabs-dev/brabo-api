CREATE TABLE "runner_device_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"public_key_jwk" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "runner_device_keys" ADD CONSTRAINT "runner_device_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runner_device_keys" ADD CONSTRAINT "runner_device_keys_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "runner_device_keys_user_idx" ON "runner_device_keys" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "runner_device_keys_project_idx" ON "runner_device_keys" USING btree ("project_id");