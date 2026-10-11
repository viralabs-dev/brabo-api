import { describe, expect, it } from 'vitest';
import { DEV_LEAD } from '../../../src/domain/agents/agent-areas';
import { ID_DO_DEV_LEAD } from '../../../src/domain/llm/tool-router';

describe('ID_DO_DEV_LEAD', () => {
  it('é igual ao DEV_LEAD de agent-areas.ts (fonte única)', () => {
    expect(ID_DO_DEV_LEAD).toBe(DEV_LEAD);
  });
  it('não é o id de um dev agent de módulo', () => {
    expect(ID_DO_DEV_LEAD).not.toBe('dev-api');
  });
});
