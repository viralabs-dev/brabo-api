import type { SessionStatus } from './session-state-machine';
import type { SessionKind } from './session-kind';

export interface Session {
  id: string;
  projectId: string;
  createdBy: string;
  status: SessionStatus;
  // FASE 20 — a INTENÇÃO com que a sessão foi aberta (RN-097). Fica ao lado de
  // `status` de propósito: são as duas classificações da sessão e respondem
  // perguntas diferentes — `kind` diz para que ela nasceu e não muda, `status`
  // diz onde ela está na máquina de estados. Nenhuma das duas é o ESTADO de
  // execução, que continua derivado do evento `execution.activated`.
  kind: SessionKind;
  // FASE 20 — nome amigável dado pelo usuário (RN-098), ou `null`. Não
  // substitui a hashtag do id em lugar nenhum da tela.
  name: string | null;
  nextSeq: number;
  createdAt: Date;
  updatedAt: Date;
  closedAt: Date | null;
  // Fase 4b — Psicólogo: motivo reportado pelo engine na transição pra um
  // estado terminal (heartbeat_timeout/killed/exceção/...); null pra
  // fechamento humano/gracioso ou sessão ainda não terminal.
  terminationReason: string | null;
  // Fase 5 — OpenTelemetry: `traceparent` W3C da span raiz da sessão, aberta
  // na criação. Todo trabalho da sessão (na api e no engine) pendura suas spans
  // neste valor, e é ele que torna a sessão recuperável no Tempo por um id só.
  traceParent: string | null;
}
