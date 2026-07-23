CREATE TYPE "public"."budget_policy" AS ENUM('block', 'allow');--> statement-breakpoint
CREATE TYPE "public"."llm_provider" AS ENUM('ollama', 'anthropic', 'openai');--> statement-breakpoint
CREATE TYPE "public"."model_binding_scope" AS ENUM('workspace', 'project', 'agent', 'session');--> statement-breakpoint
CREATE TABLE "budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid,
	"session_id" uuid,
	"limit_micros" bigint NOT NULL,
	"spent_micros" bigint DEFAULT 0 NOT NULL,
	"policy" "budget_policy" DEFAULT 'block' NOT NULL,
	"last_threshold_notified" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budgets_project_id_unique" UNIQUE("project_id"),
	CONSTRAINT "budgets_session_id_unique" UNIQUE("session_id"),
	CONSTRAINT "budgets_scope_check" CHECK (("budgets"."project_id" is not null) <> ("budgets"."session_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "model_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" "model_binding_scope" NOT NULL,
	"scope_id" text NOT NULL,
	"model_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "model_bindings_scope_scope_id_unique" UNIQUE("scope","scope_id")
);
--> statement-breakpoint
CREATE TABLE "models" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" "llm_provider" NOT NULL,
	"name" text NOT NULL,
	"display_name" text NOT NULL,
	"input_price_per_million_micros" bigint DEFAULT 0 NOT NULL,
	"output_price_per_million_micros" bigint DEFAULT 0 NOT NULL,
	"context_window" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "models_provider_name_unique" UNIQUE("provider","name")
);
--> statement-breakpoint
CREATE TABLE "token_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"actor_kind" "actor_kind" NOT NULL,
	"actor_id" text NOT NULL,
	"provider" "llm_provider" NOT NULL,
	"model_id" uuid,
	"model_name" text NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"estimated" boolean DEFAULT false NOT NULL,
	"cost_micros" bigint NOT NULL,
	"latency_ms" integer NOT NULL,
	"binding_origin" "model_binding_scope",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" "llm_provider" NOT NULL,
	"wrapped_dek" text NOT NULL,
	"dek_iv" text NOT NULL,
	"dek_auth_tag" text NOT NULL,
	"encrypted_api_key" text NOT NULL,
	"api_key_iv" text NOT NULL,
	"api_key_auth_tag" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_credentials_user_id_provider_unique" UNIQUE("user_id","provider")
);
--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_bindings" ADD CONSTRAINT "model_bindings_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."models"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_bindings" ADD CONSTRAINT "model_bindings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token_usage" ADD CONSTRAINT "token_usage_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token_usage" ADD CONSTRAINT "token_usage_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."models"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_credentials" ADD CONSTRAINT "user_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;