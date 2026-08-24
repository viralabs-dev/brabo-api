import { describe, expect, it } from 'vitest';
import { InternalGraphController } from '../../../../src/interfaces/http/internal/internal-graph.controller';
import type { UpsertPromptTemplateUseCase } from '../../../../src/application/use-cases/graph/upsert-prompt-template.use-case';
import type { GetPromptTemplateUseCase } from '../../../../src/application/use-cases/graph/get-prompt-template.use-case';

const VERSAO = {
  name: 'dev-agent-kickoff',
  version: '3',
  body: 'você é o dev agent...',
  hash: 'sha256:abc',
  createdAt: '2026-08-19T00:00:00Z',
  active: true,
};

/**
 * O contrato HTTP com o engine é FECHADO nesta fundação — a forma exata do
 * corpo importa mais do que de costume. `GET` não expõe `createdAt`/`active`
 * (a diferença deliberada em relação ao `POST`, ver `graph.response.dto.ts`);
 * este teste é o que pegaria um campo extra vazando por um `...spread`
 * descuidado no controller.
 */
describe('InternalGraphController', () => {
  it('GET: a resposta tem EXATAMENTE name/version/body/hash — sem createdAt nem active', async () => {
    const getTemplate = {
      execute: () => Promise.resolve(VERSAO),
    } as unknown as GetPromptTemplateUseCase;
    const controller = new InternalGraphController(
      {} as UpsertPromptTemplateUseCase,
      getTemplate,
    );

    const resposta = await controller.getByName('dev-agent-kickoff', '3');

    expect(resposta).toEqual({
      name: VERSAO.name,
      version: VERSAO.version,
      body: VERSAO.body,
      hash: VERSAO.hash,
    });
    expect(resposta).not.toHaveProperty('createdAt');
    expect(resposta).not.toHaveProperty('active');
  });

  it('POST: a resposta tem name/version/body/hash/active — sem createdAt', async () => {
    const upsertTemplate = {
      execute: () => Promise.resolve({ template: VERSAO, created: true }),
    } as unknown as UpsertPromptTemplateUseCase;
    const controller = new InternalGraphController(
      upsertTemplate,
      {} as GetPromptTemplateUseCase,
    );

    const resposta = await controller.upsert({
      name: VERSAO.name,
      version: VERSAO.version,
      body: VERSAO.body,
      hash: VERSAO.hash,
    });

    expect(resposta).toEqual({
      name: VERSAO.name,
      version: VERSAO.version,
      body: VERSAO.body,
      hash: VERSAO.hash,
      active: true,
    });
    expect(resposta).not.toHaveProperty('createdAt');
  });
});
