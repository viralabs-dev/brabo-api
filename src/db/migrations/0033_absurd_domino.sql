CREATE TYPE "public"."story_promotion_mode" AS ENUM('manual', 'auto');--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "story_promotion" "story_promotion_mode" DEFAULT 'manual' NOT NULL;--> statement-breakpoint
-- BACKFILL DIRIGIDO (Fase 12c, RN-048) — o DEFAULT acima vale para projeto
-- NOVO; este UPDATE vale para os que já existiam.
--
-- Sem ele, todo projeto em operação acordaria em `manual` no deploy: o PO
-- pararia de promover, nenhuma task nova viraria pegável, e os dev agents
-- ficariam ociosos sem ninguém entender por quê. Mudar o comportamento
-- debaixo de quem já opera não é uma escolha que o produto pode fazer
-- sozinho — o usuário migra quando quiser, pela tela de Configurações.
--
-- O `UPDATE` sem `WHERE` é PRECISO, não preguiçoso: no instante em que esta
-- migração roda, toda linha de `projects` é, por definição, um projeto
-- pré-existente. Não há linha nova a classificar errado. (É o mesmo
-- raciocínio do backfill da 0031, chegando à conclusão oposta porque a
-- pergunta é outra: lá "o que já existe nasceu de qual caminho?", aqui
-- "o que já existe não pode mudar de comportamento".)
UPDATE "projects" SET "story_promotion" = 'auto';--> statement-breakpoint
ALTER TABLE "stories" ADD COLUMN "proposed_ready" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "stories" ADD COLUMN "returned_reason" text;--> statement-breakpoint
ALTER TABLE "stories" ADD COLUMN "returned_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "stories_proposed_idx" ON "stories" USING btree ("project_id") WHERE "stories"."proposed_ready";