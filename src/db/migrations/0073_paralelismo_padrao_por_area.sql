-- AT-599: o teto de paralelismo padrao por area passa a ser dev 5, qa 4, infra 2.
-- Aplica a TODOS os projetos (decisao do dono, 22/10): sobrescreve o que estava
-- decidido. So as tres areas do catalogo existem nessa tabela.
UPDATE "agent_areas" SET "max_parallel" = CASE "key" WHEN 'dev' THEN 5 WHEN 'qa' THEN 4 WHEN 'infra' THEN 2 END WHERE "key" IN ('dev', 'qa', 'infra');