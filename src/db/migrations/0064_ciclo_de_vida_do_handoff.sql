-- ADR 0182, RN-635: a oferta que deixou de ser a vigente (destino ativado por
-- outro caminho, ou nova oferta ao mesmo destino no projeto). Só acrescenta o
-- valor: nenhuma linha é reescrita aqui — as ofertas duplicadas de antes são
-- substituídas, COM evento, na próxima oferta ou ativação do mesmo destino.
ALTER TYPE "public"."handoff_status" ADD VALUE 'superseded';