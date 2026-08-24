// QUEM promove uma story de draft para ready (Fase 12c, RN-048). Espelha o
// enum `story_promotion_mode` do banco.
export const STORY_PROMOTION_MODES = ['manual', 'auto'] as const;
export type StoryPromotionMode = (typeof STORY_PROMOTION_MODES)[number];

// ONDE o comando do projeto EXECUTA (RN-169/RN-421, ADR 0072/0104). Espelha
// o enum `project_execution_mode` do banco.
//
// - `container`: a pasta GERENCIADA pelo produto, dentro de
//   `PROJECT_WORKSPACES_ROOT` — é o comportamento que sempre existiu, e por
//   isso é o DEFAULT da coluna: projeto criado antes do ADR 0072 não muda de
//   lugar.
// - `mounted` (antigo `local`, renomeado pelo ADR 0104): uma pasta DO
//   USUÁRIO, de caminho absoluto livre, que só funciona se estiver montada
//   dentro do container da api E do engine (é a mesma pasta vista pelos dois
//   processos). A validação da criação recusa o que não estiver montado
//   (RN-170/RN-422) — ver `validarCaminhoDeWorkspaceLocal`.
// - `runner`: uma pasta DO USUÁRIO que NÃO precisa de bind-mount — o CLI
//   `brabo-runner` roda na máquina do usuário e confirma o caminho quando
//   conecta (RN-423). A criação valida só a parte LÉXICA (sem I/O); o
//   projeto nasce com `workspaceVerifiedAt: null` e é promovido quando a
//   confirmação chega — o runner é a fonte da verdade do caminho, podendo
//   sobrescrever o que foi digitado na criação.
//
// CUIDADO com o homônimo: nenhum destes três valores tem relação com o
// `GitProviderName` `'local'` (repositório git sem provider externo). Um
// projeto pode ser `container` + provider `local`, ou `runner` + provider
// `github` — as duas escolhas são ortogonais.
export const PROJECT_EXECUTION_MODES = [
  'container',
  'mounted',
  'runner',
] as const;
export type ProjectExecutionMode = (typeof PROJECT_EXECUTION_MODES)[number];

/**
 * O que basta para saber ONDE fica a pasta de um projeto no disco.
 *
 * Existe como tipo próprio porque `projectScopeRoot` deixou de derivar a raiz
 * de UM campo (`workspace_dir_name`) e passou a derivá-la do PAR
 * (modo, caminho) — e quem chama tem sempre o `Project` inteiro em mãos, que
 * satisfaz esta forma estruturalmente. Passar os três campos soltos convidaria
 * a esquecer um deles num chamador e derivar a raiz errada em silêncio, que é
 * exatamente o que a centralização da RN-092 existe para impedir.
 */
export interface ProjectWorkspaceLocation {
  workspaceDirName: string;
  executionMode: ProjectExecutionMode;
  workspacePath: string | null;
}

export interface Project {
  id: string;
  workspaceId: string;
  name: string;
  slug: string;
  // O nome da pasta física do workspace do projeto — CONGELADO na criação e
  // nunca recalculado (RN-109). Ver `workspaceDirNameFor` em
  // infrastructure/filesystem/project-workspaces-root.ts.
  //
  // Continua NOT NULL mesmo no modo `local`, onde não é usado como caminho:
  // ele é a identidade da pasta no vocabulário do produto (aparece em log e
  // em resposta de API), e torná-lo nullable espalharia `?? ''` por toda a
  // borda para ganhar nada.
  workspaceDirName: string;
  // ONDE o comando executa (RN-169/RN-421). NOT NULL com default `container`,
  // pelo mesmo motivo de `storyPromotion`: o valor É a decisão, e decisão não
  // fica implícita.
  executionMode: ProjectExecutionMode;
  // O caminho absoluto da pasta do usuário — preenchido para `mounted` OU
  // `runner`, obrigatoriamente nulo em `container`. O banco garante o
  // casamento dos dois com CHECK, e não só o código: os dois campos juntos
  // são a raiz de escopo, e uma linha incoerente aqui é escopo de terminal
  // apontando para lugar nenhum.
  workspacePath: string | null;
  // NULL = não verificado. Só ganha sentido em `executionMode: 'runner'` —
  // vira timestamp quando o primeiro runner conecta e confirma o caminho
  // (RN-423). `container`/`mounted` nunca preenchem este campo.
  workspaceVerifiedAt: Date | null;
  createdBy: string;
  // Teto de tokens por task dos dev agents (micro-USD). Nulo = default do
  // domínio (ver DEFAULT_TASK_BUDGET_MICROS em ActivateExecutionUseCase).
  taskBudgetMicros: number | null;
  // Circuit breaker por dev agent (Fase 12b, RN-047): tasks TERMINANDO
  // blocked em sequência até parar em idle_tripped. Nulo = default do
  // domínio (ver DEFAULT_MAX_CONSECUTIVE_BLOCKED em ActivateExecutionUseCase).
  maxConsecutiveBlocked: number | null;
  // Quem promove story a `ready` (Fase 12c, RN-048). NOT NULL: ao contrário
  // dos tetos acima, aqui não existe "nulo = default do domínio" — o valor É
  // a decisão de autoridade, e ela não fica implícita.
  storyPromotion: StoryPromotionMode;
  createdAt: Date;
  updatedAt: Date;
}
