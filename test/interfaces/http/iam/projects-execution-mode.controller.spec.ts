import { describe, expect, it, vi } from 'vitest';
import { Reflector } from '@nestjs/core';
import { ProjectsController } from '../../../../src/interfaces/http/iam/projects.controller';
import { REQUIRED_ROLE_KEY } from '../../../../src/interfaces/http/iam/require-role.decorator';

/**
 * `PUT /projects/:projectId/execution-mode` — RN-447..450, ADR 0111.
 *
 * A rota exige `maintainer`, a mesma régua de "mudar o teto é decidir
 * quanto o produto gasta sem perguntar" (`max_parallel`/`budget_micros` de
 * área) — converter `execution_mode` muda ONDE o agente escreve, decisão
 * de mesma gravidade.
 */
describe('ProjectsController — conversão de execution_mode (RN-447..450)', () => {
  it('exige maintainer, não só viewer/developer', () => {
    const reflector = new Reflector();
    expect(
      reflector.get(
        REQUIRED_ROLE_KEY,
        ProjectsController.prototype.convertExecutionModeRoute,
      ),
    ).toBe('maintainer');
  });

  it('repassa projectId e o corpo para o caso de uso, sem transformar nada', async () => {
    const convertExecutionMode = {
      execute: vi.fn().mockResolvedValue({ id: 'p1' }),
    };
    const controller = new ProjectsController(
      { execute: vi.fn() } as never,
      { execute: vi.fn() } as never,
      convertExecutionMode as never,
      { execute: vi.fn() } as never,
      { execute: vi.fn() } as never,
      { execute: vi.fn() } as never,
      { execute: vi.fn() } as never,
      { execute: vi.fn() } as never,
      { execute: vi.fn() } as never,
    );

    const resultado = await controller.convertExecutionModeRoute('p1', {
      executionMode: 'runner',
      workspacePath: '/home/alguem/projeto',
    });

    expect(convertExecutionMode.execute).toHaveBeenCalledWith('p1', {
      executionMode: 'runner',
      workspacePath: '/home/alguem/projeto',
    });
    expect(resultado).toEqual({ id: 'p1' });
  });
});
