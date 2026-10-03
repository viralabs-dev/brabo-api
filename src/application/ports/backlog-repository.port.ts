import type {
  Epic,
  Story,
  Task,
  StoryStatus,
  TaskStatus,
} from '../../domain/backlog/backlog.entity';
import type { PrGateStatus } from '../../domain/execution/pr-gate-state-machine';
import type { FailureOrigin } from '../../domain/agents/failure-origin';

export interface NewEpic {
  projectId: string;
  sessionId: string;
  title: string;
  description?: string;
}

export interface NewStory {
  epicId: string;
  projectId: string;
  sessionId: string;
  title: string;
  description?: string;
  rf?: string[];
  rnf?: string[];
  businessRuleIds?: string[];
  dod?: string[];
  dor?: string[];
}

export interface StoryContent {
  description: string;
  rf: string[];
  rnf: string[];
  businessRuleIds: string[];
  dod: string[];
  dor: string[];
}

export interface NewTask {
  storyId: string;
  title: string;
  description?: string;
}

export abstract class EpicRepository {
  abstract create(input: NewEpic): Promise<Epic>;
  abstract findById(id: string): Promise<Epic | null>;
  abstract findByProject(projectId: string): Promise<Epic[]>;
}

export abstract class StoryRepository {
  abstract create(input: NewStory): Promise<Story>;
  abstract findById(id: string): Promise<Story | null>;
  // As NÃO arquivadas (RN-727): é a leitura do backlog e da cobertura.
  abstract findByProject(projectId: string): Promise<Story[]>;
  // RN-727: o título/descrição corrigidos e o arquivamento (que também tira a história da
  // fila de promoção). `findById` continua achando a arquivada.
  abstract updateText(
    id: string,
    text: { title: string; description: string },
  ): Promise<Story>;
  abstract archive(id: string, reason: string | null): Promise<Story>;
  abstract updateStatus(id: string, status: StoryStatus): Promise<Story>;
  abstract updateModules(id: string, moduleIds: string[]): Promise<Story>;
  /**
   * Completa os campos de uma história existente (RN-720): o PO liga regras e
   * preenche RF/DoD/DoR sem recriar a história.
   */
  abstract updateContent(id: string, content: StoryContent): Promise<Story>;
  // Fase 12c (RN-048). `proposedReady` liga ao criar em modo `manual` e
  // desliga tanto na promoção quanto na recusa — sempre junto do fato que a
  // resolveu, para nunca sobrar uma story "aguardando" que já foi decidida.
  abstract setProposedReady(id: string, proposed: boolean): Promise<Story>;
  // Recusa do usuário: grava o motivo, carimba a hora e tira da fila de
  // proposta, numa escrita só.
  abstract markReturned(id: string, reason: string): Promise<Story>;
  // As stories aguardando decisão do usuário — a seção do Backlog e o badge
  // de contagem.
  abstract listProposedReady(projectId: string): Promise<Story[]>;
}

export abstract class TaskRepository {
  abstract create(input: NewTask): Promise<Task>;
  abstract findById(id: string): Promise<Task | null>;
  abstract findByStoryIds(storyIds: string[]): Promise<Task[]>;
  // A branch `feature/task-XXXXXXXX` (Engine.Dev.AgentIo) carrega os 8
  // primeiros chars do id — que É o primeiro grupo hifenizado do uuid, não
  // um substring arbitrário. Escopado por projeto (via join com stories) pra
  // não vazar task de outro projeto por colisão de prefixo. `null` sem task
  // com esse prefixo NESTE projeto.
  abstract findByProjectAndIdPrefix(
    projectId: string,
    idPrefix: string,
  ): Promise<Task | null>;
  // As tasks DESTE projeto entre `ids` (as de outro projeto, ou inexistentes,
  // simplesmente não voltam) — é por ela que o plano do Dev Lead confere que
  // cada tarefa citada existe aqui (AT-274, RN-678).
  abstract findInProjectByIds(
    projectId: string,
    ids: string[],
  ): Promise<Task[]>;
  // Grava o módulo de cada tarefa do plano aprovado (AT-274, RN-678).
  abstract assignModules(
    assignments: ReadonlyArray<{ taskId: string; module: string }>,
  ): Promise<void>;
  // Pega ATOMICAMENTE a próxima task `todo` cuja story é `ready` e cujo
  // MÓDULO é `module` (FOR UPDATE SKIP LOCKED) — 2 devs nunca pegam a mesma.
  // Desde a RN-678 o módulo é o da TAREFA (atribuído pelo Dev Lead no plano);
  // tarefa sem módulo só é pegável quando a story tem UM módulo só, e ele é
  // `module` — o único caso em que "o dev daquele módulo" não é ambíguo.
  // Marca in_progress + assignedTo. Retorna null se não há task pegável.
  abstract claimNext(
    projectId: string,
    module: string,
    agentId: string,
  ): Promise<Task | null>;
  abstract updateStatus(id: string, status: TaskStatus): Promise<Task>;
  // O merge da PR fecha a tarefa (AT-275, RN-628): `done` só se ainda não
  // estava. Atômico (UPDATE ... WHERE status <> 'done') e devolve `null` se
  // nada mudou — é isso que torna o merge repetido idempotente, sem evento.
  abstract markDoneIfNotDone(id: string): Promise<Task | null>;
  // O merge recusado por conflito devolve a tarefa ao dev agent (RN-715):
  // `in_review` → `in_progress` e `gate_status` zerado (os vereditos antigos
  // não valem para a branch rebaseada). Só a partir de `in_review`; devolve
  // `null` se nada mudou.
  abstract reabrirPorConflitoDeMerge(id: string): Promise<Task | null>;
  // Quantas tasks `todo` de story `ready` estão disponíveis pro módulo — usado
  // pra sugerir paralelização (≥2 = ramos independentes disponíveis).
  abstract countClaimableByModule(
    projectId: string,
    module: string,
  ): Promise<number>;
  // DevAgent não conseguiu concluir (Fase 4a): volta pra `todo` com o
  // diagnóstico, sem dono — EXCLUÍDA do próximo claim automático (ver
  // `claimNext`) até um humano liberar via `unblock`.
  abstract markBlocked(
    id: string,
    reason: string,
    diagnosis: string,
    origin?: FailureOrigin,
  ): Promise<Task>;
  abstract unblock(id: string): Promise<Task>;
  // Fase 4a — gates de PR: abre o fluxo (gate_status: null -> 'awaiting_qa',
  // contador zerado) quando a PR é criada; `updateGateStatus` aplica o
  // resultado de `nextGateStatus` (pr-gate-state-machine.ts) a cada parecer.
  abstract openGate(id: string): Promise<Task>;
  abstract updateGateStatus(
    id: string,
    gateStatus: PrGateStatus,
    correctionCount: number,
  ): Promise<Task>;
  // Contagem de tasks bloqueadas por projeto, pro workspace inteiro numa
  // query só — alimenta o dot de status da sidebar do dashboard. Mesmo
  // formato da consulta que já roda em DomainGaugesCollector.collectBlockedTasks
  // (índice parcial em tasks.blocked), só que escopada por workspace em vez
  // de global.
  abstract countBlockedByWorkspace(
    workspaceId: string,
  ): Promise<{ projectId: string; total: number }[]>;
}
