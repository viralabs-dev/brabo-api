CREATE TYPE "public"."recurso_de_projeto_estado" AS ENUM('pedido', 'criado', 'falhou', 'removendo', 'removido');--> statement-breakpoint
CREATE TYPE "public"."recurso_de_projeto_tipo" AS ENUM('container', 'container_qa');--> statement-breakpoint
CREATE TABLE "project_resources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"tipo" "recurso_de_projeto_tipo" NOT NULL,
	"chave" text DEFAULT '' NOT NULL,
	"portas" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"container_id" text,
	"estado" "recurso_de_projeto_estado" DEFAULT 'pedido' NOT NULL,
	"motivo" text,
	"tentativas" integer DEFAULT 0 NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_resources_projeto_tipo_chave_uq" UNIQUE("project_id","tipo","chave")
);
--> statement-breakpoint
CREATE INDEX "project_resources_estado_idx" ON "project_resources" USING btree ("estado");