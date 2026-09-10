/**
 * O vocabulário e as regras de nome da projeção de artefatos em arquivo
 * (ADR 0148, RN-523) — cada `artifact.*` do event log vira um Markdown em
 * `docs/<agente>/` dentro do workspace do projeto.
 *
 * Tudo aqui é PURO: nenhum I/O, nenhum caminho absoluto. Quem escreve é
 * `ArtifactFileStore`; quem decide ONDE a pasta mora é
 * `infrastructure/filesystem/project-workspaces-root.ts`. A separação é a
 * mesma de `graph-projection-events.ts` e existe pelo mesmo motivo: a decisão
 * de "o que projetar e com que nome" é testável sem tocar disco, e é onde os
 * erros de verdade moram.
 *
 * ## Por que um `aggregate_type` de outbox NOVO
 *
 * Mesmo argumento de `GRAPH_PROJECTION_AGGREGATE_TYPE`, e ele continua valendo
 * palavra por palavra: `Engine.Outbox.Drain.run_once/0` (lado Elixir) só drena
 * `aggregate_type IN ('session', 'task', 'container')`, e TODO evento de sessão
 * já nasce com uma linha `'session'` que aquele dreno marca `processed_at` a
 * cada ~2s. Ler o MESMO `aggregate_type` seria correr contra ele e perder a
 * corrida quase sempre. A saída, na MESMA tabela `outbox_events`: uma SEGUNDA
 * linha, na mesma transação, com um `aggregate_type` que a query do engine
 * nunca casa.
 */
export const ARTIFACT_PROJECTION_AGGREGATE_TYPE = 'artifact_projection';

/**
 * Os tipos de artefato que viram arquivo.
 *
 * A lista é de PERMITIDOS, e não de excluídos, pelo mesmo motivo que a do
 * broker (ADR 0130): tipo de artefato novo nasce FORA da projeção, e entra
 * quando alguém decidir que ele é documento — em vez de aparecer sozinho numa
 * pasta que o usuário lê.
 *
 * ## O que NÃO entra, e por quê
 *
 * `qa_verdict`, `secops_verdict`, `task_blocked` e `infra_delegation_files`
 * ficam de fora: são DESFECHOS OPERACIONAIS, não documentos do produto. Um
 * veredito de gate por task, num projeto com dezenas de tasks, encheria
 * `docs/qa-lead/` de arquivos que ninguém abre — e a pasta que o usuário abre
 * no editor perderia justamente a propriedade que a torna útil, que é caber
 * numa olhada. Eles continuam no event log, que é a fonte, e continuam
 * visíveis na timeline da sessão.
 */
export const ARTIFACT_PROJECTABLE_EVENT_TYPES: ReadonlySet<string> = new Set([
  'artifact.note',
  'artifact.business_rule',
  'artifact.decision_record',
  'artifact.product_brief',
  'artifact.module_map',
  'artifact.module_routing',
  'artifact.project_image',
  'artifact.c4_diagram',
  'artifact.prototipo_navegavel',
  'artifact.plano_de_teste',
  'artifact.threat_model',
  'artifact.insight',
  'artifact.rfc_staff',
]);

/**
 * Os tipos VERSIONADOS — os que têm um "vigente" que se substitui.
 *
 * A distinção não é estética, é a diferença entre dois modos de gravar. Estes
 * quatro são lidos por REDUÇÃO ao maior `version` (ver
 * `obter-container-do-projeto.use-case.ts` e `get-c4-diagram.use-case.ts`), e
 * o histórico deles continua inteiro no event log — a pasta mostra o VIGENTE,
 * então o arquivo é o mesmo e é sobrescrito. Os demais são append-only por
 * natureza (uma decisão não substitui a anterior: as duas aconteceram), e cada
 * um vira arquivo próprio.
 *
 * Projetar um versionado como arquivo novo por versão encheria a pasta de
 * `c4-diagram-v1.md`, `c4-diagram-v2.md` e faria quem abre ter de descobrir
 * qual vale — que é exatamente o trabalho que a redução por `version` existe
 * para poupar.
 */
export const TIPOS_DE_ARTEFATO_VERSIONADOS: ReadonlySet<string> = new Set([
  'artifact.module_map',
  'artifact.module_routing',
  'artifact.project_image',
  'artifact.c4_diagram',
]);

/** O nome da pasta, dentro do workspace do projeto. */
export const PASTA_DE_ARTEFATOS = 'docs';

/**
 * `artifact.decision_record` → `decision_record`. Usado no nome do arquivo dos
 * versionados e como prefixo do nome dos append-only.
 */
export function tipoSemPrefixo(eventType: string): string {
  return eventType.startsWith('artifact.')
    ? eventType.slice('artifact.'.length)
    : eventType;
}

/**
 * Slug de um segmento de caminho — e a ÚNICA barreira entre um payload de LLM
 * e o filesystem.
 *
 * O nome do arquivo sai do título que o modelo escreveu, então ele é entrada
 * não confiável em toda a extensão do termo: `../../etc/passwd`, `nome\0`,
 * 300 caracteres de emoji, string vazia. A defesa não é escapar o que veio —
 * é DERIVAR um nome novo de um alfabeto fechado, e é por isso que a função
 * não tem caminho de retorno em que um separador sobreviva.
 *
 * Vazio depois da normalização devolve `null`, e quem chama decide o
 * fallback: um nome derivado de nada seria um nome que colide com todos os
 * outros nomes derivados de nada.
 */
export function slugDeArquivo(bruto: string, maxLen = 60): string | null {
  const semAcento = bruto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  const limpo = semAcento
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLen)
    .replace(/-+$/g, '');

  return limpo.length > 0 ? limpo : null;
}

/**
 * A pasta do agente. `dev-checkout` e `qa-lead` já vêm em forma de slug do
 * event log, mas o campo é texto livre no envelope (`actor.id`), então passa
 * pela mesma normalização — com `agente-desconhecido` como fallback, para que
 * um ator estranho produza uma pasta visível em vez de um caminho inventado.
 */
export function pastaDoAgente(actorId: string): string {
  return slugDeArquivo(actorId, 40) ?? 'agente-desconhecido';
}

/**
 * O nome do arquivo de um artefato, DENTRO da pasta do agente.
 *
 * Versionado: o nome é o próprio tipo, e a escrita sobrescreve — a pasta
 * mostra o vigente. Append-only: `<tipo>-<slug do título>`, com o `seq` do
 * evento como desempate quando dois artefatos do mesmo tipo têm o mesmo
 * título. O `seq` é gapless por sessão e é o que já ordena o event log, então
 * ele é o desempate que não precisa de estado novo — e sem ele o segundo
 * artefato sobrescreveria calado o primeiro, que é a única forma de esta
 * projeção PERDER informação.
 */
export function nomeDeArquivoDoArtefato(input: {
  eventType: string;
  seq: number;
  titulo?: string | null;
}): string {
  const tipo = tipoSemPrefixo(input.eventType);

  if (TIPOS_DE_ARTEFATO_VERSIONADOS.has(input.eventType)) {
    return `${tipo}.md`;
  }

  const slug = input.titulo ? slugDeArquivo(input.titulo) : null;
  return slug ? `${tipo}-${slug}-${input.seq}.md` : `${tipo}-${input.seq}.md`;
}

/**
 * O título de um artefato, quando o payload tem um.
 *
 * Os schemas não concordam num campo só (`title` em `note`/`business_rule`/
 * `product_brief`, `choice` em `decision_record`, `storyId` nos de história), e
 * forçá-los a concordar seria mudar o contrato de emissão por causa de um nome
 * de arquivo. Esta função tenta os campos conhecidos em ordem e devolve `null`
 * quando nenhum serve — o nome então cai no `<tipo>-<seq>`, que é feio e é
 * verdadeiro.
 */
export function tituloDoArtefato(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const p = payload as Record<string, unknown>;
  for (const campo of [
    'title',
    'titulo',
    'choice',
    'resumo',
    'summary',
    'storyId',
  ]) {
    const valor = p[campo];
    if (typeof valor === 'string' && valor.trim().length > 0) return valor;
  }
  return null;
}
