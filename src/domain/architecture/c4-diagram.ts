// Diagrama C4 (modelo de Simon Brown, níveis Context e Container) da
// arquitetura que o Arquiteto define. Puro, sem IO: aqui mora só o que é
// verdade sobre um diagrama válido e a sintaxe Mermaid que ele produz. Quem
// grava o artefato é o caso de uso; quem o lê de volta é o event log — mesmo
// desenho de `project-container.ts` (ADR 0065), estendido para este artefato
// (ver ADR novo desta mudança).
//
// ## Por que o CONTAINER não é decisão do modelo
//
// O nível Container é DERIVADO do `module_map` vigente (mesmos módulos,
// mesmas dependências que `create_module_map` já validou contra ciclo) — o
// modelo não descreve os containers de novo. Deixar o modelo redigitar a
// lista arriscaria um diagrama que diverge do mapa real; a fonte de verdade
// dos containers é o repositório, não o que o modelo lembra de ter escrito.
//
// O nível CONTEXT não tem essa fonte: quem são os atores externos (o
// usuário, um provedor de Git, outro sistema) é julgamento do Arquiteto, e
// por isso `actors` vem do tool call.

import type { ModuleNode } from './module-graph';

/** Tipo do evento que É o artefato. Não há tabela: o event log é o registro. */
export const EVENTO_C4_DIAGRAM = 'artifact.c4_diagram';

export type TipoDeAtorC4 = 'person' | 'external_system';

export const TIPOS_DE_ATOR_C4: readonly TipoDeAtorC4[] = [
  'person',
  'external_system',
];

export interface C4Ator {
  name: string;
  type: TipoDeAtorC4;
  description: string;
}

export interface C4Diagrama {
  systemName: string;
  systemDescription: string;
  actors: C4Ator[];
  /** Sintaxe Mermaid `C4Context` — o sistema e os atores externos. */
  contextDiagram: string;
  /** Sintaxe Mermaid `C4Container` — os módulos do module_map e as dependências. */
  containerDiagram: string;
}

/** O estado do diagrama C4 de um projeto, do ponto de vista de quem lê. */
export interface EstadoDoC4Diagrama {
  status: 'sem_diagrama' | 'gerado';
  diagrama: C4Diagrama | null;
  /** Versão do artefato vigente — 0 quando não há diagrama. */
  version: number;
  /** Id do evento que gerou a versão vigente, para auditoria. */
  eventId: string | null;
  createdAt: string | null;
}

export const SEM_DIAGRAMA: EstadoDoC4Diagrama = {
  status: 'sem_diagrama',
  diagrama: null,
  version: 0,
  eventId: null,
  createdAt: null,
};

export class C4DiagramaInvalidoError extends Error {}

export interface EntradaC4 {
  systemName: string;
  systemDescription: string;
  actors: C4Ator[];
}

export interface EntradaC4Input {
  systemName?: unknown;
  systemDescription?: unknown;
  actors?: unknown;
}

const TAMANHO_MAX_NOME = 120;
const TAMANHO_MAX_DESCRICAO = 400;

/**
 * Valida e normaliza a entrada do modelo. Lança `C4DiagramaInvalidoError` com
 * a mensagem que volta ao modelo pelo tool-result (RN-061): ele lê o que
 * faltou e corrige, em vez de tentar de novo do mesmo jeito.
 */
export function validarEntradaC4(input: EntradaC4Input): EntradaC4 {
  const systemName =
    typeof input.systemName === 'string' ? input.systemName.trim() : '';
  if (systemName.length === 0) {
    throw new C4DiagramaInvalidoError(
      '`system_name` é obrigatório: como o sistema/projeto se chama no ' +
        'diagrama de contexto.',
    );
  }

  const systemDescription =
    typeof input.systemDescription === 'string'
      ? input.systemDescription.trim()
      : '';

  const brutos = Array.isArray(input.actors) ? input.actors : [];
  const actors = brutos.map((a, indice) => validarAtor(a, indice));

  return {
    systemName: cortar(systemName, TAMANHO_MAX_NOME),
    systemDescription: cortar(systemDescription, TAMANHO_MAX_DESCRICAO),
    actors,
  };
}

function validarAtor(bruto: unknown, indice: number): C4Ator {
  const a = (bruto ?? {}) as Record<string, unknown>;
  const name = typeof a.name === 'string' ? a.name.trim() : '';
  if (name.length === 0) {
    throw new C4DiagramaInvalidoError(
      `actors[${indice}].name é obrigatório: quem é este ator externo.`,
    );
  }

  const type = a.type;
  if (type !== undefined && !TIPOS_DE_ATOR_C4.includes(type as TipoDeAtorC4)) {
    throw new C4DiagramaInvalidoError(
      `actors[${indice}].type inválido: "${descreverValor(type)}". Use ` +
        '"person" (default) ou "external_system".',
    );
  }

  const description =
    typeof a.description === 'string' ? a.description.trim() : '';

  return {
    name: cortar(name, TAMANHO_MAX_NOME),
    type: type === 'external_system' ? 'external_system' : 'person',
    description: cortar(description, TAMANHO_MAX_DESCRICAO),
  };
}

function cortar(texto: string, max: number): string {
  return texto.length > max ? texto.slice(0, max) : texto;
}

/**
 * Descreve um valor `unknown` para MENSAGEM de erro, sem o `no-base-to-string`
 * de `String(objeto)` — mesmo helper de `project-container.ts`.
 */
function descreverValor(valor: unknown): string {
  if (typeof valor === 'string') return valor;
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

// --- Sintaxe Mermaid ---
//
// Sem regex: um nome de módulo ou ator vem do modelo (ou, no caso dos
// módulos, do que o modelo escreveu em create_module_map), e um
// `js/polynomial-redos` aqui seria a mesma HIGH do CodeQL que
// `project-container.ts` já evita — caractere a caractere, mesmo estilo de
// `referenciaDeImagemValida`.

/**
 * Escapa um texto para caber dentro de um label Mermaid entre aspas: aspas
 * duplas viram simples (a sintaxe usa aspas duplas como delimitador) e
 * quebra de linha vira espaço (a gramática é por LINHA). Corta em `max` —
 * um label de centenas de caracteres não ajuda a leitura do diagrama.
 */
function escaparLabel(texto: string, max = 200): string {
  let out = '';
  for (const ch of texto) {
    if (out.length >= max) break;
    if (ch === '"') out += "'";
    else if (ch === '\n' || ch === '\r') out += ' ';
    else out += ch;
  }
  return out.trim();
}

/**
 * Identificador Mermaid válido a partir de um nome livre: minúsculas,
 * `[a-z0-9_]`, começando por letra, deduplicado contra os já usados no
 * MESMO diagrama (dois módulos com nomes que colidem no slug, ex.: "API" e
 * "api", não podem virar o mesmo alias).
 */
function paraId(nome: string, usados: Set<string>): string {
  let slug = '';
  for (const ch of nome.toLowerCase()) {
    if ((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9')) slug += ch;
    else slug += '_';
  }
  slug = slug.slice(0, 40);
  if (slug.length === 0 || !(slug[0] >= 'a' && slug[0] <= 'z')) {
    slug = `m_${slug}`;
  }

  let final = slug;
  let i = 2;
  while (usados.has(final)) {
    final = `${slug}_${i}`;
    i += 1;
  }
  usados.add(final);
  return final;
}

/**
 * Diagrama de CONTEXTO: o sistema e os atores externos que o Arquiteto
 * declarou. Nível 1 do C4 — não entra módulo nenhum aqui, de propósito: quem
 * olha o Contexto pergunta "quem usa isto e com o que ele conversa", não
 * "como é feito por dentro".
 */
export function gerarDiagramaContexto(entrada: EntradaC4): string {
  const usados = new Set<string>();
  const sistemaId = paraId(entrada.systemName, usados);

  // Um id por ator, fixado UMA vez — a lista alimenta tanto a declaração
  // (Person/System_Ext) quanto o Rel logo abaixo, e nunca diverge entre as
  // duas (recalcular o id duas vezes arriscaria uma dedup diferente).
  const atoresComId = entrada.actors.map((ator) => ({
    ator,
    id: paraId(ator.name, usados),
  }));

  const linhas: string[] = [
    'C4Context',
    `  title Diagrama de Contexto -- ${escaparLabel(entrada.systemName)}`,
    '',
  ];

  for (const { ator, id } of atoresComId) {
    const macro = ator.type === 'external_system' ? 'System_Ext' : 'Person';
    linhas.push(
      `  ${macro}(${id}, "${escaparLabel(ator.name)}", "${escaparLabel(ator.description)}")`,
    );
  }
  linhas.push('');

  linhas.push(
    `  System(${sistemaId}, "${escaparLabel(entrada.systemName)}", "${escaparLabel(entrada.systemDescription)}")`,
  );
  linhas.push('');

  for (const { ator, id } of atoresComId) {
    const verbo = ator.type === 'external_system' ? 'Integra com' : 'Usa';
    linhas.push(`  Rel(${id}, ${sistemaId}, "${verbo}")`);
  }

  return linhas.join('\n');
}

/**
 * Diagrama de CONTAINER: os módulos do `module_map` vigente, com stack e
 * responsabilidade, dentro do boundary do sistema, e as dependências entre
 * eles — as MESMAS que `create_module_map` já validou sem ciclo. Aresta para
 * um módulo que não está na lista (não devia acontecer, o grafo já foi
 * validado) é ignorada aqui, mesma tolerância de `module-graph.ts`.
 */
export function gerarDiagramaContainer(
  entrada: EntradaC4,
  modules: ModuleNode[],
): string {
  const usados = new Set<string>();
  const boundaryId = paraId(entrada.systemName, usados);

  const linhas: string[] = [
    'C4Container',
    `  title Diagrama de Container -- ${escaparLabel(entrada.systemName)}`,
    '',
    `  System_Boundary(${boundaryId}, "${escaparLabel(entrada.systemName)}") {`,
  ];

  const idsPorModulo = new Map<string, string>();
  for (const m of modules) {
    const id = paraId(m.name, usados);
    idsPorModulo.set(m.name, id);
    linhas.push(
      `    Container(${id}, "${escaparLabel(m.name)}", "${escaparLabel(m.stack)}", "${escaparLabel(m.responsibility)}")`,
    );
  }
  if (modules.length === 0) {
    linhas.push(
      `    Container(${paraId('sem_modulos', usados)}, "Nenhum módulo definido", "", "")`,
    );
  }
  linhas.push('  }');

  const arestas: string[] = [];
  for (const m of modules) {
    const origem = idsPorModulo.get(m.name);
    if (!origem) continue;
    for (const dep of m.dependsOn) {
      const destino = idsPorModulo.get(dep);
      if (!destino) continue;
      arestas.push(`  Rel(${origem}, ${destino}, "depende de")`);
    }
  }
  if (arestas.length > 0) {
    linhas.push('');
    linhas.push(...arestas);
  }

  return linhas.join('\n');
}
