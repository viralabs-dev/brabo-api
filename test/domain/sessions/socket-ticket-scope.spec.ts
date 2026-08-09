import { describe, it, expect } from 'vitest';
import {
  SOCKET_TICKET_SCOPES,
  minRoleForSocketTicketScope,
} from '../../../src/domain/sessions/socket-ticket-scope';
import { roleAtLeast } from '../../../src/domain/iam/role';

describe('socket-ticket-scope (RN-108)', () => {
  it('heartbeat exige só viewer', () => {
    expect(minRoleForSocketTicketScope('heartbeat')).toBe('viewer');
  });

  it('terminal exige developer — mesmo papel de MIN_ROLE_FOR_ACTION_TYPE.terminal', () => {
    expect(minRoleForSocketTicketScope('terminal')).toBe('developer');
  });

  it('todo escopo tem papel mínimo declarado', () => {
    for (const scope of SOCKET_TICKET_SCOPES) {
      const minRole = minRoleForSocketTicketScope(scope);
      expect(roleAtLeast(minRole, minRole)).toBe(true);
    }
  });
});
