import { describe, it, expect } from 'vitest';
import { ValidationPipe } from '@nestjs/common';
import { UnblockTaskDto } from '../../../../src/interfaces/http/execution/dto/unblock-task.dto';
import { RecordGateVerdictInternalDto } from '../../../../src/interfaces/http/internal/dto/record-gate-verdict-internal.dto';
import { UpdateTaskInternalDto } from '../../../../src/interfaces/http/internal/dto/create-story-internal.dto';
import { PISO_DO_MENU } from '../../../../src/domain/llm/tool-router';

// Mesmo pipe do main.ts (whitelist + forbidNonWhitelisted).
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});
const validar = (metatype: new () => object, value: object) =>
  pipe.transform(value, { type: 'body', metatype });

describe('DTOs da AT-909/AT-905/AT-918', () => {
  it('RN-1124: unblock aceita corpo vazio e orientação; recusa > 2000', async () => {
    await expect(validar(UnblockTaskDto, {})).resolves.toBeDefined();
    await expect(
      validar(UnblockTaskDto, { orientacao: 'siga o contrato' }),
    ).resolves.toMatchObject({ orientacao: 'siga o contrato' });
    await expect(
      validar(UnblockTaskDto, { orientacao: 'x'.repeat(2001) }),
    ).rejects.toThrow();
  });

  it('RN-1126: o verdict com melhorias é ACEITO (forbidNonWhitelisted)', async () => {
    const base = {
      projectId: '11111111-1111-4111-8111-111111111111',
      taskId: '22222222-2222-4222-8222-222222222222',
      gate: 'qa',
      veredito: 'approved',
      resumo: 'ok',
      itens: [],
    };
    await expect(
      validar(RecordGateVerdictInternalDto, { ...base, melhorias: ['a'] }),
    ).resolves.toMatchObject({ melhorias: ['a'] });
    await expect(
      validar(RecordGateVerdictInternalDto, { ...base, melhorias: [1] }),
    ).rejects.toThrow();
  });

  it('RN-1128: update_task aceita agentId arquiteto', async () => {
    await expect(
      validar(UpdateTaskInternalDto, {
        projectId: '11111111-1111-4111-8111-111111111111',
        agentId: 'arquiteto',
        title: 'novo',
      }),
    ).resolves.toMatchObject({ agentId: 'arquiteto' });
  });

  it('RN-1129: o piso do Arquiteto tem search_workspace', () => {
    expect(PISO_DO_MENU.arquiteto).toContain('search_workspace');
  });
});
