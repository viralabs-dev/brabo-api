// Contratos entre módulos (tool `declare_module_contracts` do Arquiteto,
// ADR 0200, RN-684). Puro, sem IO: aqui mora só o que é verdade sobre uma
// lista de contratos válida. Quem grava o artefato é o caso de uso; quem o lê
// de volta é o event log — mesmo desenho de `module-routing.ts` e
// `c4-diagram.ts`.
//
// ## Por que existe
//
// No uso real de 2026-09-29, `dev-board-engine` gastou 5 dos seus 24 passos
// com ferramenta lendo o WORKTREE de outros módulos para descobrir a
// interface deles. O `module_map` diz quem depende de quem (`dependsOn`),
// nunca O QUE um módulo expõe: a interface só existia no código que outro
// dev agent estava escrevendo, numa branch que ainda não tinha chegado à
// `dev`.
//
// ## O formato, e por que é o menor que resolve
//
// Por módulo, só o que ele EXPÕE — uma lista de itens `{tipo, assinatura,
// descricao}`. O que ele CONSOME não é redigitado aqui: é DERIVADO do
// `dependsOn` do `module_map` vigente na leitura (o mesmo argumento do nível
// Container do C4): o mapa já validou essas arestas sem ciclo, e uma segunda
// lista escrita à mão divergiria dele no primeiro mapa revisado. Quem consome
// um módulo lê a lista inteira do que ele expõe — a granularidade "quais itens
// de X o módulo Y usa" não é algo que o Arquiteto saiba antes da
// implementação, e nenhum dev precisou dela no uso real.
//
// `tipo` é um enum curto porque é o que muda a forma de USAR o item (chamar
// uma função, bater numa rota, assinar um evento, montar um dado), e a
// `assinatura` é texto livre porque a stack de cada módulo é livre (a função
// de um módulo Elixir e a rota de um módulo Go não cabem num schema só).

/** Tipo do evento que É o artefato. Não há tabela: o event log é o registro. */
export const EVENTO_MODULE_CONTRACTS = 'artifact.module_contracts';

export type TipoDeItemDeContrato = 'funcao' | 'rota' | 'evento' | 'dado';

export const TIPOS_DE_ITEM_DE_CONTRATO: readonly TipoDeItemDeContrato[] = [
  'funcao',
  'rota',
  'evento',
  'dado',
];

export interface ItemDeContrato {
  tipo: TipoDeItemDeContrato;
  /** Como se usa: `placePiece(board, piece, pos): Board`, `GET /scores`. */
  assinatura: string;
  /** O que o item faz/garante. Pode ser vazia. */
  descricao: string;
}

export interface ContratoDeModulo {
  /** Nome do módulo — precisa existir no `module_map` vigente. */
  modulo: string;
  /** O que o módulo expõe a quem depende dele. Ao menos um item. */
  expoe: ItemDeContrato[];
}

/** O estado dos contratos de um projeto, do ponto de vista de quem lê. */
export interface EstadoDosContratos {
  status: 'sem_contratos' | 'declarados';
  contratos: ContratoDeModulo[];
  /** Versão do artefato vigente — 0 quando não há contratos. */
  version: number;
  /** Id do evento que fixou a versão vigente, para auditoria. */
  eventId: string | null;
  createdAt: string | null;
}

export const SEM_CONTRATOS: EstadoDosContratos = {
  status: 'sem_contratos',
  contratos: [],
  version: 0,
  eventId: null,
  createdAt: null,
};

export class ContratoInvalidoError extends Error {}

export interface ItemDeContratoInput {
  tipo?: unknown;
  assinatura?: unknown;
  descricao?: unknown;
}

export interface ContratoDeModuloInput {
  modulo?: unknown;
  expoe?: unknown;
}

/**
 * Tetos do que se escreve. Não são de estética: o contrato é LIDO por todo
 * dev agent do projeto, e cada item vai para o contexto dele. Um contrato que
 * vira a documentação da API inteira custaria em todo passo o que a leitura
 * do worktree custava num.
 */
export const MAX_ITENS_POR_MODULO = 40;
export const TAMANHO_MAX_ASSINATURA = 300;
export const TAMANHO_MAX_DESCRICAO = 300;

/**
 * Valida e normaliza a lista inteira. Lança `ContratoInvalidoError` com a
 * mensagem que volta ao modelo pelo tool-result (RN-061), nomeando o módulo e
 * o item que falharam.
 *
 * O que este arquivo NÃO valida: se `modulo` existe no `module_map` vigente.
 * Essa checagem depende de IO e mora no caso de uso, no mesmo padrão de
 * `route_modules_to_infra`.
 */
export function validarContratos(
  itens: ContratoDeModuloInput[],
): ContratoDeModulo[] {
  if (!Array.isArray(itens) || itens.length === 0) {
    throw new ContratoInvalidoError(
      'declare_module_contracts exige ao menos um contrato — um por módulo ' +
        'que expõe algo a outro. Lista vazia não é uma declaração.',
    );
  }

  const vistos = new Set<string>();
  const contratos: ContratoDeModulo[] = [];

  for (const item of itens) {
    const modulo = typeof item.modulo === 'string' ? item.modulo.trim() : '';
    if (modulo.length === 0) {
      throw new ContratoInvalidoError(
        'Um contrato da lista não tem `modulo` (string não vazia) — diga de ' +
          'QUAL módulo do module_map vigente é esta interface.',
      );
    }
    if (vistos.has(modulo)) {
      throw new ContratoInvalidoError(
        `Módulo "${modulo}" aparece mais de uma vez — cada módulo tem UM ` +
          'contrato, com todos os itens que expõe juntos.',
      );
    }
    vistos.add(modulo);

    const brutos = Array.isArray(item.expoe) ? item.expoe : [];
    if (brutos.length === 0) {
      throw new ContratoInvalidoError(
        `Módulo "${modulo}": \`expoe\` está vazio. Um módulo que não expõe ` +
          'nada a outro não precisa de contrato — omita-o da lista.',
      );
    }
    if (brutos.length > MAX_ITENS_POR_MODULO) {
      throw new ContratoInvalidoError(
        `Módulo "${modulo}": ${brutos.length} itens em \`expoe\`, o teto é ` +
          `${MAX_ITENS_POR_MODULO}. O contrato é o que OUTRO módulo usa, não ` +
          'a documentação inteira deste.',
      );
    }

    contratos.push({
      modulo,
      expoe: brutos.map((b, i) => validarItem(modulo, b, i)),
    });
  }

  return contratos;
}

function validarItem(
  modulo: string,
  bruto: unknown,
  indice: number,
): ItemDeContrato {
  const it = (bruto ?? {}) as Record<string, unknown>;
  const onde = `Módulo "${modulo}", expoe[${indice}]`;

  const tipo = it.tipo;
  if (!TIPOS_DE_ITEM_DE_CONTRATO.includes(tipo as TipoDeItemDeContrato)) {
    throw new ContratoInvalidoError(
      `${onde}: \`tipo\` inválido (${descreverValor(tipo)}). Use ` +
        '"funcao", "rota", "evento" ou "dado".',
    );
  }

  const assinatura =
    typeof it.assinatura === 'string' ? it.assinatura.trim() : '';
  if (assinatura.length === 0) {
    throw new ContratoInvalidoError(
      `${onde}: \`assinatura\` é obrigatória — como OUTRO módulo usa este ` +
        'item (ex.: `placePiece(board, piece, pos): Board`, `GET /scores`).',
    );
  }
  if (assinatura.length > TAMANHO_MAX_ASSINATURA) {
    throw new ContratoInvalidoError(
      `${onde}: \`assinatura\` com ${assinatura.length} caracteres, o teto é ` +
        `${TAMANHO_MAX_ASSINATURA}. Descreva o detalhe em \`descricao\`.`,
    );
  }

  const descricao = typeof it.descricao === 'string' ? it.descricao.trim() : '';

  return {
    tipo: tipo as TipoDeItemDeContrato,
    assinatura,
    descricao:
      descricao.length > TAMANHO_MAX_DESCRICAO
        ? descricao.slice(0, TAMANHO_MAX_DESCRICAO)
        : descricao,
  };
}

/** Mesmo helper de `c4-diagram.ts`: valor `unknown` para mensagem de erro. */
function descreverValor(valor: unknown): string {
  if (typeof valor === 'string') return `"${valor}"`;
  if (typeof valor === 'number' || typeof valor === 'boolean') {
    return String(valor);
  }
  if (valor === null || valor === undefined) return String(valor);
  try {
    return JSON.stringify(valor);
  } catch {
    return '(valor não serializável)';
  }
}
