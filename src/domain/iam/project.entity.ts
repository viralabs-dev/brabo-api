// QUEM promove uma story de draft para ready (Fase 12c, RN-048). Espelha o
// enum `story_promotion_mode` do banco.
export const STORY_PROMOTION_MODES = ['manual', 'auto'] as const;
export type StoryPromotionMode = (typeof STORY_PROMOTION_MODES)[number];

// ONDE o código do projeto mora no disco (RN-169, ADR 0072). Espelha o enum
// `project_workspace_mode` do banco.
//
// - `container`: a pasta GERENCIADA pelo produto, dentro de
//   `PROJECT_WORKSPACES_ROOT` — é o comportamento que sempre existiu, e por
//   isso é o DEFAULT da coluna: projeto criado antes do ADR 0072 não muda de
//   lugar.
// - `local`: uma pasta DO USUÁRIO, de caminho absoluto livre, que só funciona
//   se estiver montada dentro do container da api E do engine (é a mesma
//   pasta vista pelos dois processos). A validação da criação recusa o que
//   não estiver montado (RN-170) — ver `validarCaminhoDeWorkspaceLocal`.
//
// CUIDADO com o homônimo: `local` aqui é MODO DE WORKSPACE, e não tem relação
// com o `GitProviderName` `'local'` (repositório git sem provider externo).
// Um projeto pode ser `container` + provider `local`, ou `local` + provider
// `github` — as duas escolhas são ortogonais.
export const PROJECT_WORKSPACE_MODES = ['container', 'local'] as const;
export type ProjectWorkspaceMode = (typeof PROJECT_WORKSPACE_MODES)[number];

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
  workspaceMode: ProjectWorkspaceMode;
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
  // ONDE o código mora (RN-169). NOT NULL com default `container`, pelo mesmo
  // motivo de `storyPromotion`: o valor É a decisão, e decisão não fica
  // implícita.
  workspaceMode: ProjectWorkspaceMode;
  // O caminho absoluto da pasta do usuário — preenchido SÓ no modo `local`, e
  // obrigatoriamente nulo no modo `container`. O banco garante o casamento dos
  // dois com CHECK, e não só o código: os dois campos juntos são a raiz de
  // escopo, e uma linha incoerente aqui é escopo de terminal apontando para
  // lugar nenhum.
  workspacePath: string | null;
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
