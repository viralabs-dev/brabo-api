-- ADR 0113 — o quarto escopo honesto do índice do Chat RAG: `local`, uma
-- pasta do PRÓPRIO usuário anexada como referência de leitura via upload do
-- navegador (RN-454). Aditivo puro: os dois CHECK de `chunks`
-- (`chunks_session_id_casa_com_escopo`/`chunks_source_path_casa_com_escopo`,
-- migração `0045`) já são escritos em cima de "é `session` ou não é" —
-- `local` cai no mesmo lado de `docs`/`adr` sem precisar de constraint nova.
ALTER TYPE "public"."chunk_scope" ADD VALUE 'local';
