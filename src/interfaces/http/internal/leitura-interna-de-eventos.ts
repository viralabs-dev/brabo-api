import { BadRequestException } from '@nestjs/common';
import type { ListPaginatedOptions } from '../../../application/ports/session-event-repository.port';

/**
 * Quantos tipos uma leitura interna pode pedir de uma vez. O maior pedido real
 * hoje é o kickoff do Arquiteto, com três; o teto existe para a lista não virar
 * um parâmetro sem fim numa rota que só o engine chama (ADR 0060: leitura com
 * teto, sem parâmetro livre).
 */
export const TETO_DE_TIPOS_POR_LEITURA = 20;

// Os tipos de evento do produto são minúsculos, com ponto e sublinhado
// (`artifact.business_rule`, `context.compacted`). Qualquer outra coisa é erro
// do chamador, dito como 400 — não uma lista vazia que pareceria "não há".
const TIPO_DE_EVENTO = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$/;

/**
 * Converte a query string de `GET /internal/sessions/:id/events` nas opções do
 * repositório. Até a RN-580 a rota só lia `afterSeq` e `limit`, e o engine — que
 * só usava `limit=200` — recebia os PRIMEIROS 200 eventos: o agente reidratado
 * acordava sem o fim da conversa. `latest` e `types` são ADITIVOS: sem eles a
 * resposta é byte a byte a de antes.
 */
export function opcoesDaLeituraInterna(query: {
  afterSeq?: string;
  limit?: string;
  latest?: string;
  types?: string;
}): ListPaginatedOptions {
  const tipos =
    query.types === undefined
      ? undefined
      : query.types
          .split(',')
          .map((t) => t.trim())
          .filter((t) => t !== '');

  if (tipos && tipos.length > TETO_DE_TIPOS_POR_LEITURA) {
    throw new BadRequestException(
      `types aceita no máximo ${TETO_DE_TIPOS_POR_LEITURA} tipos (vieram ${tipos.length})`,
    );
  }

  const invalido = tipos?.find((t) => !TIPO_DE_EVENTO.test(t));
  if (invalido !== undefined) {
    throw new BadRequestException(`tipo de evento inválido em types: ${invalido}`);
  }

  return {
    afterSeq: query.afterSeq !== undefined ? Number(query.afterSeq) : undefined,
    limit: query.limit !== undefined ? Number(query.limit) : undefined,
    latest: query.latest === 'true',
    ...(tipos && tipos.length > 0 ? { types: tipos } : {}),
  };
}
