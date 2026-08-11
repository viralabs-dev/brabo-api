import type { Role } from '../iam/role';

/**
 * Escopo do ticket opaco de uso único que autentica `connect/3` do socket
 * Phoenix da sessão (RN-108).
 *
 * `heartbeat` é o socket de heartbeat/eventos ao vivo que já existe hoje
 * (`SessionSocket`/`SessionChannel`, sem terminal nenhum). `terminal` está
 * declarado aqui para o papel mínimo já nascer certo quando o socket de
 * terminal interativo existir (FASE 25) — hoje nenhuma rota emite ticket
 * `terminal` de verdade, mas o valor do escopo e o papel que ele exige já são
 * a decisão certa, e adiar só moveria esta tabela para dentro da fase futura.
 */
export const SOCKET_TICKET_SCOPES = ['heartbeat', 'terminal'] as const;

export type SocketTicketScope = (typeof SOCKET_TICKET_SCOPES)[number];

/**
 * Mesmo papel mínimo de `MIN_ROLE_FOR_ACTION_TYPE.terminal` em
 * `domain/actions/decide.ts` — abrir um socket com escopo `terminal` é a
 * mesma decisão de autoridade que propor uma ação de terminal.
 */
const MIN_ROLE_FOR_SOCKET_TICKET_SCOPE: Record<SocketTicketScope, Role> = {
  heartbeat: 'viewer',
  terminal: 'developer',
};

export function minRoleForSocketTicketScope(scope: SocketTicketScope): Role {
  return MIN_ROLE_FOR_SOCKET_TICKET_SCOPE[scope];
}
