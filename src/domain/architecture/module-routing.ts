// Roteamento de módulos para infra (tool `route_modules_to_infra` do
// Arquiteto). Puro, sem IO: aqui mora só o que é verdade sobre uma lista de
// roteamento válida. Quem grava o artefato é o caso de uso; quem o lê de
// volta é o event log — mesmo desenho de `project-container.ts` (ADR 0065) e
// `c4-diagram.ts`, estendido para este artefato (ADR 0131).
//
// ## Arquiteto candidata, Infra elege
//
// Este arquivo só valida a CANDIDATURA: um item por módulo, com a imagem que
// o Arquiteto propõe e o porquê. A escolha final (elegível entre as
// candidatas, ou recusa) é do Infra Lead, num PR à parte — este módulo não
// decide nada além de "isto é uma candidatura bem formada".
//
// ## Por que reusar `validarDecisaoDeImagem`, e não reimplementar
//
// A imagem candidata de cada módulo é, no que importa, a MESMA decisão que
// `choose_project_image` já valida (tag/digest explícito, `latest` recusado,
// `rationale` com motivo real) — só que uma vez por módulo em vez de uma vez
// por projeto. Duas validações da mesma regra divergem cedo ou tarde; esta
// aqui delega.

import {
  ImagemInvalidaError,
  validarDecisaoDeImagem,
} from '../containers/project-container';

/** Tipo do evento que É o artefato. Não há tabela: o event log é o registro. */
export const EVENTO_MODULE_ROUTING = 'artifact.module_routing';

export interface RoteamentoDeModulo {
  /** Nome do módulo — precisa existir no `module_map` vigente do projeto. */
  modulo: string;
  /** Referência OCI com tag ou digest, validada como em `choose_project_image`. */
  imagemCandidata: string;
  /** Por que ESTA imagem para ESTE módulo. Mínimo 10 caracteres (delegado). */
  porque: string;
}

/** O estado do roteamento de módulos de um projeto, do ponto de vista de quem lê. */
export interface EstadoDoRoteamento {
  status: 'sem_roteamento' | 'roteado';
  roteamento: RoteamentoDeModulo[];
  /** Versão do artefato vigente — 0 quando não há roteamento. */
  version: number;
  /** Id do evento que fixou a versão vigente, para auditoria. */
  eventId: string | null;
  createdAt: string | null;
}

export const SEM_ROTEAMENTO: EstadoDoRoteamento = {
  status: 'sem_roteamento',
  roteamento: [],
  version: 0,
  eventId: null,
  createdAt: null,
};

export class RoteamentoInvalidoError extends Error {}

export interface RoteamentoDeModuloInput {
  modulo?: unknown;
  imagemCandidata?: unknown;
  porque?: unknown;
}

/**
 * Valida e normaliza a lista inteira. Lança `RoteamentoInvalidoError` com a
 * mensagem que volta ao modelo pelo tool-result (RN-061): ele lê o item (e o
 * motivo) que falhou e corrige, em vez de reemitir a lista inteira igual.
 *
 * Três recusas são DESTE arquivo (forma da lista): vazia, módulo sem nome, e
 * módulo repetido — cada módulo recebe UM roteamento, então uma segunda
 * entrada para o mesmo nome não é revisão, é ambiguidade sobre qual imagem
 * vale. A quarta recusa é DELEGADA: a imagem candidata de cada item passa por
 * `validarDecisaoDeImagem`, e o motivo dela (tag ausente, `latest`,
 * `rationale` curto) chega ao modelo com o nome do módulo na frente, para não
 * obrigar quem lê a adivinhar qual dos N itens falhou.
 *
 * O que este arquivo NÃO valida: se `modulo` existe no `module_map` vigente
 * do projeto. Essa checagem depende de IO (ler o mapa) e mora no caso de uso,
 * no mesmo padrão de `assign_story_modules`/`missingModules`.
 */
export function validarRoteamento(
  itens: RoteamentoDeModuloInput[],
): RoteamentoDeModulo[] {
  if (!Array.isArray(itens) || itens.length === 0) {
    throw new RoteamentoInvalidoError(
      'route_modules_to_infra exige ao menos um item — um roteamento por ' +
        'módulo do module_map vigente. Lista vazia não é uma decisão.',
    );
  }

  const vistos = new Set<string>();
  const roteamento: RoteamentoDeModulo[] = [];

  for (const item of itens) {
    const modulo = typeof item.modulo === 'string' ? item.modulo.trim() : '';
    if (modulo.length === 0) {
      throw new RoteamentoInvalidoError(
        'Um item da lista não tem `modulo` (string não vazia) — diga a QUAL ' +
          'módulo do module_map vigente esta imagem se refere.',
      );
    }
    if (vistos.has(modulo)) {
      throw new RoteamentoInvalidoError(
        `Módulo "${modulo}" aparece mais de uma vez na lista — cada módulo ` +
          'recebe UM roteamento. Duas entradas para o mesmo módulo são ' +
          'ambíguas: qual das duas imagens vale?',
      );
    }
    vistos.add(modulo);

    try {
      const decisao = validarDecisaoDeImagem({
        image: item.imagemCandidata,
        rationale: item.porque,
      });
      roteamento.push({
        modulo,
        imagemCandidata: decisao.image,
        porque: decisao.rationale,
      });
    } catch (e) {
      if (e instanceof ImagemInvalidaError) {
        throw new RoteamentoInvalidoError(`Módulo "${modulo}": ${e.message}`);
      }
      throw e;
    }
  }

  return roteamento;
}
