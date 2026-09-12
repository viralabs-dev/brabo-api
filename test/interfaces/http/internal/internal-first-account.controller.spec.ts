import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { InternalFirstAccountController } from '../../../../src/interfaces/http/internal/internal-first-account.controller';
import type { CriarPrimeiraContaUseCase } from '../../../../src/application/use-cases/auth/criar-primeira-conta.use-case';
import {
  CABECALHO_SERVICE_TOKEN,
  EngineServiceGuard,
} from '../../../../src/interfaces/http/auth/engine-service.guard';

const TOKEN = 'token-de-servico-desta-instalacao';

function contextoCom(cabecalhos: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers: cabecalhos }) }),
  } as unknown as ExecutionContext;
}

describe('InternalFirstAccountController (RN-546, ADR 0155)', () => {
  it('caminho feliz: repassa o corpo ao caso de uso e devolve os três ids', async () => {
    const execute = vi.fn(() =>
      Promise.resolve({
        userId: 'user-1',
        email: 'voce@exemplo.dev',
        workspaceId: 'ws-1',
      }),
    );
    const controller = new InternalFirstAccountController({
      execute,
    } as unknown as CriarPrimeiraContaUseCase);

    const resposta = await controller.criar({
      email: 'voce@exemplo.dev',
      senha: 'uma frase longa e minha',
      nome: 'Fulana',
    });

    expect(resposta).toEqual({
      userId: 'user-1',
      email: 'voce@exemplo.dev',
      workspaceId: 'ws-1',
    });
    expect(execute).toHaveBeenCalledWith({
      email: 'voce@exemplo.dev',
      senha: 'uma frase longa e minha',
      nome: 'Fulana',
    });
  });

  it('`nome` ausente vira `null` explícito — o caso de uso nunca recebe `undefined`', async () => {
    const execute = vi.fn(() =>
      Promise.resolve({ userId: 'u', email: 'e', workspaceId: 'w' }),
    );
    const controller = new InternalFirstAccountController({
      execute,
    } as unknown as CriarPrimeiraContaUseCase);

    await controller.criar({
      email: 'voce@exemplo.dev',
      senha: 'uma frase longa e minha',
    });

    expect(execute).toHaveBeenCalledWith({
      email: 'voce@exemplo.dev',
      senha: 'uma frase longa e minha',
      nome: null,
    });
  });
});

/**
 * A rota é `@ServiceRoute()` + `@UseGuards(EngineServiceGuard)`: quem a
 * protege é o segredo da instalação, e é a única coisa entre um scanner de
 * porta e a criação do `owner` do primeiro workspace. Um teste do controller
 * sozinho não veria isso — daí exercitar o guard com o MESMO cabeçalho que a
 * rota declara.
 */
describe('InternalFirstAccountController — sem service token válido', () => {
  const antes = process.env.BRABO_SERVICE_TOKEN;

  beforeEach(() => {
    process.env.BRABO_SERVICE_TOKEN = TOKEN;
  });
  afterEach(() => {
    if (antes === undefined) delete process.env.BRABO_SERVICE_TOKEN;
    else process.env.BRABO_SERVICE_TOKEN = antes;
  });

  it('cabeçalho AUSENTE: 403, e o caso de uso nem é alcançado', () => {
    const guard = new EngineServiceGuard();
    expect(() => guard.canActivate(contextoCom({}))).toThrow(
      ForbiddenException,
    );
  });

  it('token ERRADO: 403 — não basta apresentar qualquer coisa', () => {
    const guard = new EngineServiceGuard();
    expect(() =>
      guard.canActivate(
        contextoCom({ [CABECALHO_SERVICE_TOKEN]: 'chute-de-quem-escaneou' }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('token CERTO: passa', () => {
    const guard = new EngineServiceGuard();
    expect(
      guard.canActivate(contextoCom({ [CABECALHO_SERVICE_TOKEN]: TOKEN })),
    ).toBe(true);
  });
});
