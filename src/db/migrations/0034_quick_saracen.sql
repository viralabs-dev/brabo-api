CREATE TABLE "workspace_models" (
	"workspace_id" uuid NOT NULL,
	"model_id" uuid NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"curated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_models_workspace_id_model_id_pk" PRIMARY KEY("workspace_id","model_id")
);
--> statement-breakpoint
ALTER TABLE "workspace_models" ADD CONSTRAINT "workspace_models_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_models" ADD CONSTRAINT "workspace_models_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."models"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_models" ADD CONSTRAINT "workspace_models_curated_by_users_id_fk" FOREIGN KEY ("curated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workspace_models_workspace_idx" ON "workspace_models" USING btree ("workspace_id");--> statement-breakpoint
-- Backfill ANTES do DROP (ADR 0049). A curadoria era global: uma coluna em
-- `models` valendo para a instalação inteira. Preservá-la significa dar a
-- CADA workspace existente exatamente o que ele enxergava até agora — o
-- produto cartesiano é intencional, não descuido.
--
-- Só as linhas ATIVAS entram. Ausência de linha é o desligado (não existe
-- estado "nunca decidido" separado), então materializar as inativas criaria
-- ruído sem significado nenhum.
--
-- `curated_by` fica nulo: a decisão veio de uma curadoria global que nunca
-- registrou dono. Nulo aqui é "não sabemos quem", e é mais honesto que
-- atribuir a decisão ao criador do workspace.
INSERT INTO "workspace_models" ("workspace_id", "model_id", "is_active", "curated_by")
SELECT w."id", m."id", true, NULL
FROM "workspaces" w
CROSS JOIN "models" m
WHERE m."is_active" = true
ON CONFLICT ("workspace_id", "model_id") DO NOTHING;--> statement-breakpoint
ALTER TABLE "models" DROP COLUMN "is_active";