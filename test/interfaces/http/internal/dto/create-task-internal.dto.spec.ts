import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateTaskInternalDto } from '../../../../../src/interfaces/http/internal/dto/create-task-internal.dto';

const base = {
  projectId: '01JC4Z0000PROJETO0000000001',
  storyId: '01JC4Z0000HISTORIA000000001',
  title: 't',
};
const erros = (extra: object) =>
  validate(plainToInstance(CreateTaskInternalDto, { ...base, ...extra })).then(
    (e) => e.map((x) => x.property),
  );

describe('CreateTaskInternalDto.agentRole', () => {
  it('aceita po, dev_lead e ausente', async () => {
    for (const extra of [{}, { agentRole: 'po' }, { agentRole: 'dev_lead' }]) {
      expect(await erros(extra)).not.toContain('agentRole');
    }
  });
  it('recusa agente fora da lista', async () => {
    expect(await erros({ agentRole: 'qa' })).toContain('agentRole');
  });
});
