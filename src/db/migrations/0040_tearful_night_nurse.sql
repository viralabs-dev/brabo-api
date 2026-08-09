ALTER TYPE "public"."model_binding_scope" ADD VALUE 'area' BEFORE 'agent';--> statement-breakpoint
-- FASE 23 / ADR 0064 — o binding de agente passa a ser POR PROJETO, e o
-- `scope_id` dele vira `<projectId>:<slug>`.
--
-- O backfill ESPALHA em vez de apagar, e a razão é preservar o que cada projeto
-- resolvia ONTEM: um binding global de `arquiteto` valia para todos os
-- projetos, então todos ganham uma linha própria com o mesmo modelo. Apagar
-- trocaria o modelo de todo mundo de uma vez; escolher um projeto "dono" seria
-- inventar informação que a linha global nunca teve (ela não guarda projeto,
-- nem workspace — ver `workspaceDoEscopo` em set-model-binding.use-case.ts).
--
-- `NOT LIKE '%:%'` torna o passo idempotente: linha já convertida não é
-- reconvertida, e `ON CONFLICT DO NOTHING` protege quem já tiver a chave nova.
-- Nenhum valor 'area' é USADO aqui, e é por isso que o ALTER TYPE acima pode
-- conviver com DML na mesma transação.
INSERT INTO "model_bindings" ("scope", "scope_id", "model_id", "created_by", "created_at", "updated_at")
SELECT 'agent', "p"."id" || ':' || "b"."scope_id", "b"."model_id", "b"."created_by", "b"."created_at", "b"."updated_at"
FROM "model_bindings" "b"
CROSS JOIN "projects" "p"
WHERE "b"."scope" = 'agent' AND "b"."scope_id" NOT LIKE '%:%'
ON CONFLICT ("scope", "scope_id") DO NOTHING;--> statement-breakpoint
DELETE FROM "model_bindings" WHERE "scope" = 'agent' AND "scope_id" NOT LIKE '%:%';
