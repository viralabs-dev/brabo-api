import type { StoryStatus } from './story-state-machine';
import type { PrGateStatus } from '../execution/pr-gate-state-machine';
import type { FailureOrigin } from '../agents/failure-origin';

export type { StoryStatus };

export interface Epic {
  id: string;
  projectId: string;
  sessionId: string;
  title: string;
  description: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Story {
  id: string;
  epicId: string;
  projectId: string;
  sessionId: string;
  title: string;
  description: string;
  rf: string[];
  rnf: string[];
  businessRuleIds: string[];
  dod: string[];
  dor: string[];
  moduleIds: string[];
  status: StoryStatus;
  // Fase 12c (RN-048): o PO terminou e a story aguarda a decisão do usuário.
  // Convive com `status: 'draft'` — a flag não é um estado, é uma proposta.
  proposedReady: boolean;
  // Por que o usuário devolveu a story ao PO, e quando.
  returnedReason: string | null;
  returnedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type TaskStatus = 'todo' | 'in_progress' | 'in_review' | 'done';

export interface Task {
  id: string;
  storyId: string;
  title: string;
  description: string;
  status: TaskStatus;
  assignedTo: string | null;
  blocked: boolean;
  blockedReason: string | null;
  // Fase 8b (ADR 0020/0038) — a ORIGEM do bloqueio, quando conhecida. Ver o
  // moduledoc de `MarkTaskBlockedUseCase`: nasce `null` pra todo bloqueio da
  // Fase 4a (não retrofitado nesta entrega), preenchido só pelo `QaLeadServer`.
  blockedOrigin: FailureOrigin | null;
  gateStatus: PrGateStatus | null;
  gateCorrectionCount: number;
  createdAt: Date;
  updatedAt: Date;
}

// Árvore aninhada pro endpoint de backlog / UI.
export interface StoryWithTasks extends Story {
  tasks: Task[];
}

export interface EpicWithStories extends Epic {
  stories: StoryWithTasks[];
}
