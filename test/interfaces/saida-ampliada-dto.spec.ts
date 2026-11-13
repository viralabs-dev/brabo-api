import { describe, it, expect } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { RunLlmTurnDto } from '../../src/interfaces/http/internal/dto/run-llm-turn.dto';
import { StreamLlmTurnDto } from '../../src/interfaces/http/internal/dto/stream-llm-turn.dto';

const base = {
  projectId: '9b1c2d3e-4f50-4a61-8b72-0c3d4e5f6a7b',
  messages: [{ role: 'user', content: 'oi' }],
};

describe.each([
  ['RunLlmTurnDto', RunLlmTurnDto],
  ['StreamLlmTurnDto', StreamLlmTurnDto],
])('%s — saidaAmpliada (AT-920, RN-1304)', (_nome, cls) => {
  const erros = (extra: object) =>
    validateSync(plainToInstance(cls, { ...base, ...extra }) as object);

  it('aceita booleano e a ausência', () => {
    expect(erros({ saidaAmpliada: true })).toHaveLength(0);
    expect(erros({})).toHaveLength(0);
  });

  it('recusa o que não é booleano', () => {
    const e = erros({ saidaAmpliada: 'sim' });
    expect(e.map((x) => x.property)).toEqual(['saidaAmpliada']);
  });
});
