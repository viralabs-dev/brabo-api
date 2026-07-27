// Máquina de estados de história (Fase 3b): draft → ready → in_progress → done.
// Puro, sem IO (espelha domain/sessions/session-state-machine.ts). A regra de
// prontidão (DoD/DoR/RF/regra) que porteia especificamente draft→ready vive em
// story-readiness.ts e é aplicada pelo use-case ANTES desta transição.

export const STORY_STATUSES = [
  'draft',
  'ready',
  'in_progress',
  'done',
] as const;

export type StoryStatus = (typeof STORY_STATUSES)[number];

export class InvalidStoryTransitionError extends Error {
  readonly from: StoryStatus;
  readonly to: StoryStatus;

  constructor(from: StoryStatus, to: StoryStatus) {
    super(`Transição de história inválida: "${from}" -> "${to}"`);
    this.name = 'InvalidStoryTransitionError';
    this.from = from;
    this.to = to;
  }
}

const ALLOWED_TRANSITIONS: Record<StoryStatus, readonly StoryStatus[]> = {
  draft: ['ready'],
  // Pode voltar pra draft (retrabalho) ou seguir pra execução.
  ready: ['in_progress', 'draft'],
  in_progress: ['done', 'ready'],
  done: [],
};

export function canTransition(from: StoryStatus, to: StoryStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function assertTransition(from: StoryStatus, to: StoryStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidStoryTransitionError(from, to);
  }
}
