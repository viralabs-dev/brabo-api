import { describe, expect, it, vi } from 'vitest';
import { Reflector } from '@nestjs/core';
import { ProjectsController } from '../../../../src/interfaces/http/iam/projects.controller';
import { REQUIRED_ROLE_KEY } from '../../../../src/interfaces/http/iam/require-role.decorator';

/*
 * `Controller.prototype.<método>` entra aqui como CHAVE de metadata: o
 * `Reflector` só lê o que os decorators penduraram no método, nunca o invoca.
 * `@typescript-eslint/unbound-method` não distingue os dois usos, então a
 * supressão fica aqui, com o motivo (a mesma de
 * `workspaces-project-folders.controller.spec.ts`).
 */
/* eslint-disable @typescript-eslint/unbound-method */

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

/**
 * `PUT /projects/:projectId/mirror-path` — RN-515, ADR 0147 ponto 4.
 *
 * Mesmo papel mínimo da conversão de modo, e pelo mesmo motivo: a rota fala
 * de um caminho do computador do OPERADOR, como `projects-base` e
 * `project-folders`. O que ela grava não é metadado do projeto — é para onde
 * o agente local vai escrever na máquina de alguém.
 */
describe('ProjectsController — destino do espelho (RN-515)', () => {
  it('exige maintainer, não só viewer/developer', () => {
    const reflector = new Reflector();
    expect(
      reflector.get(
        REQUIRED_ROLE_KEY,
        ProjectsController.prototype.setMirrorPathRoute,
      ),
    ).toBe('maintainer');
  });

  it('repassa projectId e o corpo para o caso de uso, sem transformar nada', async () => {
    const setMirrorPath = {
      execute: vi.fn().mockResolvedValue({ id: 'p1' }),
    };
    const controller = new ProjectsController(
      { execute: vi.fn() } as never,
      { execute: vi.fn() } as never,
      { execute: vi.fn() } as never,
      setMirrorPath as never,
      { execute: vi.fn() } as never,
      { execute: vi.fn() } as never,
      { execute: vi.fn() } as never,
      { execute: vi.fn() } as never,
      { execute: vi.fn() } as never,
      { execute: vi.fn() } as never,
      { execute: vi.fn() } as never,
    );

    const resultado = await controller.setMirrorPathRoute('p1', {
      mirrorPath: '/home/alguem/espelhos/loja',
    });

    expect(setMirrorPath.execute).toHaveBeenCalledWith('p1', {
      mirrorPath: '/home/alguem/espelhos/loja',
    });
    expect(resultado).toEqual({ id: 'p1' });
  });

  it('LIMPAR é `null` explícito, e chega ao caso de uso como null', async () => {
    const setMirrorPath = {
      execute: vi.fn().mockResolvedValue({ id: 'p1', mirrorPath: null }),
    };
    const controller = new ProjectsController(
      { execute: vi.fn() } as never,
      { execute: vi.fn() } as never,
      { execute: vi.fn() } as never,
      setMirrorPath as never,
      { execute: vi.fn() } as never,
      { execute: vi.fn() } as never,
      { execute: vi.fn() } as never,
      { execute: vi.fn() } as never,
      { execute: vi.fn() } as never,
      { execute: vi.fn() } as never,
      { execute: vi.fn() } as never,
    );

    await controller.setMirrorPathRoute('p1', { mirrorPath: null });

    expect(setMirrorPath.execute).toHaveBeenCalledWith('p1', {
      mirrorPath: null,
    });
  });
});
