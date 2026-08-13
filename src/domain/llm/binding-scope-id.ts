import type { ModelBindingScope } from './model-binding-scope';

/**
 * O `scope_id` dos escopos que são POR PROJETO (ADR 0064).
 *
 * ## O formato, e por que ele é declarado aqui
 *
 * `<projectId>:<chave>` — o UUID do projeto, dois pontos, e a chave da área
 * (`dev`, `qa`, `infra`) ou o slug do agente (`criativo`, `dev-api`). Nenhum
 * dos dois lados contém `:`: UUID é hexadecimal com hífens e slug de agente é
 * `[a-z0-9-]`, o que torna o primeiro `:` um separador não ambíguo.
 *
 * `workspace`, `project` e `session` continuam guardando um UUID puro: eles JÁ
 * identificam sozinhos a linha de que falam. `agent` e `area` não — o mesmo
 * `qa` existe em todo projeto —, e é essa diferença que o formato registra.
 *
 * ## Por que `agent` passou a ser composto (a incoerência que a FASE 23 fechou)
 *
 * Até aqui o binding de agente era GLOBAL: `setAgentBinding` recebia
 * `:projectId` na rota e o descartava de propósito, então escolher o modelo do
 * `arquiteto` na tela de Configurações de um projeto mudava o modelo dele em
 * TODOS. Com a área virando padrão herdável isso deixou de ser só surpreendente
 * e passou a ser incoerente: o padrão seria por projeto e a divergência global,
 * de modo que divergir aqui desfaria a herança lá — e "voltar a herdar", que é
 * APAGAR o binding do agente, apagaria a decisão de projetos que o usuário nem
 * está olhando. Ver `docs/adr/0064-*.md`.
 */
const SEPARADOR = ':';

/** Os escopos cujo `scope_id` é composto — os que existem POR PROJETO. */
export function ehEscopoDeProjeto(scope: ModelBindingScope): boolean {
  return scope === 'agent' || scope === 'area';
}

export function chaveDeAgente(projectId: string, agentSlug: string): string {
  return `${projectId}${SEPARADOR}${agentSlug}`;
}

export function chaveDeArea(projectId: string, areaKey: string): string {
  return `${projectId}${SEPARADOR}${areaKey}`;
}

export interface ChaveDeProjeto {
  projectId: string;
  chave: string;
}

/**
 * Quebra `<projectId>:<chave>` — `null` quando a string não tem o formato.
 *
 * Corta no PRIMEIRO `:` e não faz `split` cego: `split(':')` devolveria três
 * pedaços para um id malformado e o chamador escolheria um deles em silêncio.
 */
export function lerChaveDeProjeto(scopeId: string): ChaveDeProjeto | null {
  const corte = scopeId.indexOf(SEPARADOR);
  if (corte <= 0) return null;

  const projectId = scopeId.slice(0, corte);
  const chave = scopeId.slice(corte + 1);
  if (!chave) return null;
  return { projectId, chave };
}

/**
 * `scope_id` sem projeto num escopo que exige um.
 *
 * Existe porque o `scope_id` é TEXT e nada no banco distingue `qa` de
 * `<uuid>:qa`: gravar o formato antigo criaria um binding que a cascata nunca
 * mais encontraria — invisível, e não um erro. Falhar na escrita é o que torna
 * isso um bug de chamador em vez de um binding fantasma.
 */
export class ScopeIdSemProjetoError extends Error {
  constructor(
    readonly scope: ModelBindingScope,
    readonly scopeId: string,
  ) {
    super(
      `O escopo "${scope}" é por projeto: o scope_id tem de ser ` +
        `"<projectId>:<chave>", e veio "${scopeId}".`,
    );
    this.name = 'ScopeIdSemProjetoError';
  }
}

export function assertScopeIdBemFormado(
  scope: ModelBindingScope,
  scopeId: string,
): void {
  if (!ehEscopoDeProjeto(scope)) return;
  if (lerChaveDeProjeto(scopeId)) return;
  throw new ScopeIdSemProjetoError(scope, scopeId);
}
