CREATE TYPE "public"."git_provider" AS ENUM('local', 'github', 'gitlab');--> statement-breakpoint
CREATE TABLE "project_git_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"provider" "git_provider" NOT NULL,
	"wrapped_dek" text NOT NULL,
	"dek_iv" text NOT NULL,
	"dek_auth_tag" text NOT NULL,
	"encrypted_api_key" text NOT NULL,
	"api_key_iv" text NOT NULL,
	"api_key_auth_tag" text NOT NULL,
	"access_token_expires_at" timestamp with time zone,
	"account_login" text,
	"account_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"connected_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_git_connections_project_id_provider_unique" UNIQUE("project_id","provider")
);
--> statement-breakpoint
CREATE TABLE "project_repositories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"provider" "git_provider" NOT NULL,
	"external_id" text NOT NULL,
	"url" text NOT NULL,
	"default_branch" text DEFAULT 'main' NOT NULL,
	"visibility" text NOT NULL,
	"provisioned_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_repositories_project_id_unique" UNIQUE("project_id")
);
--> statement-breakpoint
ALTER TABLE "project_git_connections" ADD CONSTRAINT "project_git_connections_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_git_connections" ADD CONSTRAINT "project_git_connections_connected_by_users_id_fk" FOREIGN KEY ("connected_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_repositories" ADD CONSTRAINT "project_repositories_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_repositories" ADD CONSTRAINT "project_repositories_provisioned_by_users_id_fk" FOREIGN KEY ("provisioned_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;