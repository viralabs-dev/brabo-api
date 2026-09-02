CREATE TYPE "public"."rag_verdict" AS ENUM('util', 'irrelevante');--> statement-breakpoint
CREATE TABLE "rag_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"search_id" uuid NOT NULL,
	"chunk_id" uuid NOT NULL,
	"verdict" "rag_verdict" NOT NULL,
	"actor_kind" "actor_kind" NOT NULL,
	"actor_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rag_feedback_um_voto_por_ator" UNIQUE("search_id","chunk_id","actor_id")
);
--> statement-breakpoint
CREATE TABLE "rag_searches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"session_id" uuid,
	"actor_kind" "actor_kind" NOT NULL,
	"actor_id" text NOT NULL,
	"query" text NOT NULL,
	"top_k" integer NOT NULL,
	"hits" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"degraded" boolean NOT NULL,
	"vector_available" boolean NOT NULL,
	"pesos" jsonb NOT NULL,
	"latency_ms" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rag_feedback" ADD CONSTRAINT "rag_feedback_search_id_rag_searches_id_fk" FOREIGN KEY ("search_id") REFERENCES "public"."rag_searches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rag_feedback" ADD CONSTRAINT "rag_feedback_chunk_id_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."chunks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rag_searches" ADD CONSTRAINT "rag_searches_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rag_searches" ADD CONSTRAINT "rag_searches_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rag_feedback_search_idx" ON "rag_feedback" USING btree ("search_id");--> statement-breakpoint
CREATE INDEX "rag_searches_project_created_idx" ON "rag_searches" USING btree ("project_id","created_at");