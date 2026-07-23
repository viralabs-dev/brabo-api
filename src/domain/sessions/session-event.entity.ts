export type ActorKind = 'user' | 'agent' | 'system';

export interface Actor {
  kind: ActorKind;
  id: string;
}

/** Envelope do evento — {id ULID, session_id, seq, type, actor, payload, created_at}. */
export interface SessionEvent {
  id: string;
  sessionId: string;
  seq: number;
  type: string;
  actor: Actor;
  payload: unknown;
  createdAt: Date;
}
