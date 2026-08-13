-- BACKFILL da FASE 18 (RN-094): projeto que já existia também tem áreas.
--
-- `agent_areas` nasceu na FASE 14d e nunca foi gravada: `upsert` existia sem
-- NENHUM chamador, então `GET /projects/:id/agent-areas` devolvia `[]` e o teto
-- de paralelismo — o mecanismo que impede o produto de gastar sem autorização —
-- lia tabela vazia e caía no default sem ninguém ter decidido nada. O código
-- passou a semear na criação do projeto; sem este backfill, todo projeto criado
-- antes disso continuaria quebrado, e o defeito ficaria corrigido só para quem
-- começasse do zero.
--
-- A lista aqui é CÓPIA CONGELADA de `src/domain/agents/agent-areas.ts` no dia
-- desta migração, e é assim que tem de ser: migração é fato histórico e não
-- pode passar a inserir área nova porque a lista mudou depois. Área nova é
-- decisão de produto, com ADR, e chega em migração própria.
--
-- `max_parallel` fica no DEFAULT da coluna (2): esta migração faz a área
-- EXISTIR, não decide teto — quem decide teto é o usuário, em Configurações.
--
-- A área de `dev` entra SEM membros, de propósito: os membros dela são um por
-- módulo do `module_map`, decididos pelo Arquiteto e diferentes em cada
-- projeto. Não são enumeráveis em migração; chegam na ativação da execução.
INSERT INTO "agent_areas" ("project_id", "key", "lead_agent_id")
SELECT p."id", a."key", a."lead"
FROM "projects" p
CROSS JOIN (VALUES
  ('dev', 'dev-lead'),
  ('qa', 'qa'),
  ('infra', 'infra')
) AS a("key", "lead")
ON CONFLICT ("project_id", "key") DO NOTHING;--> statement-breakpoint
INSERT INTO "agent_area_members" ("area_id", "agent_id")
SELECT a."id", m."agent_id"
FROM "agent_areas" a
JOIN (VALUES
  ('qa', 'qa-automacao'),
  ('qa', 'qa-performance-seguranca'),
  ('infra', 'infra-workflows')
) AS m("key", "agent_id") ON m."key" = a."key"
ON CONFLICT ("area_id", "agent_id") DO NOTHING;
