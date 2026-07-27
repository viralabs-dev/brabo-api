import type { OpenAPIObject } from '@nestjs/swagger';

/**
 * Ordenação estável do documento OpenAPI (Fase 7b, item 7).
 *
 * ## Por que isto é requisito e não capricho
 *
 * `docs/reference/api/openapi.json` é versionado e o `docs:check` o compara
 * BYTE A BYTE com o que o gerador produz. A ordem que o Nest entrega vem da
 * ordem de registro dos módulos — determinística para um mesmo código, mas
 * sensível a qualquer reordenação de `imports` no `AppModule`. Sem normalizar,
 * mover uma linha de import produziria um diff de milhares de linhas no JSON,
 * e o próximo passo previsível seria alguém desligar o check.
 *
 * Ordenar também torna o diff LEGÍVEL: rota nova aparece como um bloco no
 * lugar alfabético dela, e não no meio do arquivo.
 */

/** Ordem dos verbos dentro de um caminho — a de leitura, não a alfabética. */
const VERBOS = [
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'head',
  'options',
  'trace',
] as const;

function ordenarChaves<T>(
  objeto: Record<string, T>,
  comparar: (a: string, b: string) => number = (a, b) => a.localeCompare(b),
): Record<string, T> {
  const saida: Record<string, T> = {};
  for (const chave of Object.keys(objeto).sort(comparar)) {
    saida[chave] = objeto[chave];
  }
  return saida;
}

function posicaoDoVerbo(verbo: string): number {
  const i = VERBOS.indexOf(verbo as (typeof VERBOS)[number]);
  // Chave que não é verbo (`parameters`, `summary`, extensões `x-`) vai para o
  // fim, em ordem alfabética entre si.
  return i === -1 ? VERBOS.length : i;
}

/** Devolve uma cópia do documento com toda ordenação fixada. */
export function normalizarDocumento(documento: OpenAPIObject): OpenAPIObject {
  const normalizado: OpenAPIObject = { ...documento };

  normalizado.paths = ordenarChaves(documento.paths ?? {});
  for (const caminho of Object.keys(normalizado.paths)) {
    const operacoes = normalizado.paths[caminho] as Record<string, unknown>;
    normalizado.paths[caminho] = ordenarChaves(operacoes, (a, b) => {
      const delta = posicaoDoVerbo(a) - posicaoDoVerbo(b);
      return delta !== 0 ? delta : a.localeCompare(b);
    });

    for (const verbo of Object.keys(normalizado.paths[caminho])) {
      const operacao = (normalizado.paths[caminho] as Record<string, unknown>)[
        verbo
      ] as { responses?: Record<string, unknown>; tags?: string[] } | undefined;
      if (!operacao || typeof operacao !== 'object') continue;
      if (operacao.responses) {
        // Código de status ordenado como NÚMERO: alfabeticamente, "429" viria
        // antes de "500" por acaso e "default" no meio da lista.
        operacao.responses = ordenarChaves(operacao.responses, (a, b) => {
          const na = Number(a);
          const nb = Number(b);
          if (Number.isNaN(na) || Number.isNaN(nb)) return a.localeCompare(b);
          return na - nb;
        });
      }
      if (Array.isArray(operacao.tags))
        operacao.tags = [...operacao.tags].sort();
    }
  }

  if (documento.components?.schemas) {
    normalizado.components = {
      ...documento.components,
      schemas: ordenarChaves(documento.components.schemas),
    };
  }

  if (Array.isArray(documento.tags)) {
    normalizado.tags = [...documento.tags].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }

  return normalizado;
}

/** O JSON exatamente como ele é gravado: 2 espaços e quebra de linha final. */
export function serializarDocumento(documento: OpenAPIObject): string {
  return `${JSON.stringify(normalizarDocumento(documento), null, 2)}\n`;
}
