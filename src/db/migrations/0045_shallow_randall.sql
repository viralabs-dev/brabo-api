-- `docker/postgres/init.sql` só roda na PRIMEIRA inicialização do volume
-- (achado do plano do PROGRAMA 28) — um ambiente com volume antigo pode não
-- ter a extensão. IF NOT EXISTS é idempotente: local (onde já está
-- instalada) e um ambiente novo passam pela mesma linha sem diferença de
-- comportamento. Requer que o role da aplicação tenha privilégio de criar
-- extensão (CREATEDB, ou a extensão marcada "trusted" pelo DBA) — em
-- produção isso pode não ser verdade, e é essa a razão desta migração ter
-- nascido em branch `breaking/`: se a migração falhar aqui, é ação do
-- operador antes do deploy (rodar `CREATE EXTENSION vector;` como
-- superusuário uma vez), não bug do produto.
CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TYPE "public"."chunk_scope" AS ENUM('docs', 'adr', 'session');--> statement-breakpoint
CREATE TABLE "chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"scope" "chunk_scope" NOT NULL,
	"session_id" uuid,
	"source_path" text,
	"content" text NOT NULL,
	"embedding" vector(768),
	"search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('portuguese', content)) STORED,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chunks_session_id_casa_com_escopo" CHECK (("chunks"."scope" = 'session') = ("chunks"."session_id" IS NOT NULL)),
	CONSTRAINT "chunks_source_path_casa_com_escopo" CHECK (("chunks"."scope" = 'session') = ("chunks"."source_path" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chunks_project_scope_idx" ON "chunks" USING btree ("project_id","scope");--> statement-breakpoint
CREATE INDEX "chunks_session_idx" ON "chunks" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "chunks_search_vector_idx" ON "chunks" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "chunks_embedding_idx" ON "chunks" USING hnsw ("embedding" vector_cosine_ops);