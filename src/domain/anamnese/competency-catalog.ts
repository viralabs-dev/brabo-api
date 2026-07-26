// GUARDA-CORPO da Anamnese (Fase 4b, CLAUDE.md 4b.9): a Anamnese NUNCA
// infere atributos sensíveis (saúde, características pessoais, traços de
// personalidade) — só competências TÉCNICAS e DE PROCESSO observáveis no
// event log.
//
// A garantia é ESTRUTURAL, não uma instrução de prompt: o catálogo de
// competências permitidas é derivado deterministicamente (stacks do
// module_map + lista de processo hard-coded aqui) e QUALQUER competência
// fora dele é rejeitada na validação do lote, antes de virar linha no
// banco. Um modelo que tentasse emitir "ansiedade" ou "saúde mental"
// simplesmente não passa — não há caminho de escrita que aceite.
//
// Puro, sem IO — espelha o estilo de module-graph.ts/decide.ts.

// Competências de processo (independem do stack do projeto).
export const PROCESS_COMPETENCIES = [
  'git',
  'agile',
  'arquitetura',
  'testes',
  'seguranca',
  'infra',
] as const;

export type ProcessCompetency = (typeof PROCESS_COMPETENCIES)[number];

export class CompetencyNotAllowedError extends Error {
  readonly competency: string;

  constructor(competency: string) {
    super(
      `Competência "${competency}" não está no catálogo permitido — a Anamnese só perfila competências técnicas (stacks do módulo) e de processo`,
    );
    this.name = 'CompetencyNotAllowedError';
    this.competency = competency;
  }
}

/**
 * Normaliza um nome de competência pra comparação: minúsculas, sem
 * espaços nas pontas, espaços internos colapsados. As stacks do
 * module_map são texto livre digitado pelo Arquiteto ("NestJS",
 * "nestjs ", "Nest JS"), então sem normalizar o catálogo não casaria.
 */
export function normalizeCompetency(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

// Separadores com que o Arquiteto costuma listar mais de uma tecnologia no
// mesmo campo `stack` ("NestJS + Drizzle + Postgres", "React 19, Vite").
const STACK_SEPARATORS = /[+,/&]/;

/**
 * Quebra uma `stack` de texto livre nas tecnologias que ela lista.
 *
 * `ModuleMapModule.stack` é UMA string escrita pelo Arquiteto (ver
 * module-graph.ts), e na prática ela lista várias tecnologias. Sem quebrar,
 * o catálogo ganhava só a frase inteira — então a emissão natural
 * ("nestjs") caía fora do catálogo e o LOTE INTEIRO era rejeitado, deixando
 * a Anamnese incapaz de gravar perfil em qualquer projeto realista.
 *
 * A frase inteira CONTINUA no catálogo: quem escreveu "Node.js" (um token
 * só, com ponto) não pode deixar de valer.
 *
 * Token de 1 caractere é descartado — não é competência, e alargar o
 * catálogo com ruído é exatamente o que o guarda-corpo não pode fazer.
 */
function tokenizeStack(stack: string): string[] {
  const inteira = normalizeCompetency(stack);
  if (inteira === '') return [];

  const tokens = inteira
    .split(STACK_SEPARATORS)
    .map((t) => normalizeCompetency(t))
    .filter((t) => t.length > 1);

  return [inteira, ...tokens];
}

/**
 * Catálogo permitido = stacks do module_map vigente (normalizadas,
 * tokenizadas, deduplicadas) + as competências de processo. Sem module_map,
 * sobram só as de processo — a Anamnese ainda funciona, com escopo menor.
 */
export function deriveCatalog(stacks: string[]): Set<string> {
  const catalog = new Set<string>(PROCESS_COMPETENCIES);
  for (const stack of stacks) {
    for (const competency of tokenizeStack(stack)) catalog.add(competency);
  }
  return catalog;
}

export function isAllowedCompetency(
  name: string,
  catalog: Set<string>,
): boolean {
  return catalog.has(normalizeCompetency(name));
}

export function assertAllowedCompetency(
  name: string,
  catalog: Set<string>,
): void {
  if (!isAllowedCompetency(name, catalog)) {
    throw new CompetencyNotAllowedError(name);
  }
}
