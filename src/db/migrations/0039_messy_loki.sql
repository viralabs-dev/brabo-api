CREATE TYPE "public"."session_kind" AS ENUM('consultiva', 'criativa');--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "kind" "session_kind" DEFAULT 'consultiva' NOT NULL;--> statement-breakpoint
-- BACKFILL DIRIGIDO (FASE 20, RN-097) — o DEFAULT acima vale para sessão NOVA;
-- este UPDATE vale para as que já existiam.
--
-- O default é `consultiva` porque é o tipo que pode MENOS: sessão que chegue
-- sem intenção declarada não ganha o direito de executar. Aplicar esse mesmo
-- valor às linhas antigas, porém, seria mudar o comportamento debaixo de quem
-- já opera — até esta migração NÃO HAVIA escolha nenhuma a fazer, toda sessão
-- nascia igual, e algumas delas são exatamente as sessões em que os dev agents
-- estão trabalhando agora. Acordar `consultiva`, elas passariam a RECUSAR
-- `execution.activated`, e reativar a execução de um projeto em andamento
-- falharia sem que ninguém tivesse decidido coisa alguma.
--
-- O `UPDATE` sem `WHERE` é PRECISO, não preguiçoso: no instante em que esta
-- migração roda, toda linha de `sessions` é, por definição, anterior à
-- distinção. Não há linha nova a classificar errado. (Mesmo raciocínio do
-- backfill da 0033.)
UPDATE "sessions" SET "kind" = 'criativa';--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "name" text;
