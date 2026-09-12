import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { InternalMachineDeviceKeysController } from '../../../../src/interfaces/http/internal/internal-machine-device-keys.controller';
import type { RegistrarChaveDeMaquinaUseCase } from '../../../../src/application/use-cases/auth/registrar-chave-de-maquina.use-case';
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

describe('InternalMachineDeviceKeysController (RN-552, ADR 0155 ponto 4)', () => {
  it('caminho feliz: devolve o `id` que vira `kid`, o dono RESOLVIDO e o que foi substituído', async () => {
    const execute = vi.fn(() =>
      Promise.resolve({
        id: 'device-1',
        userId: 'user-1',
        name: 'servidor-de-casa',
        createdAt: new Date('2026-09-12T12:00:00.000Z'),
        substituidas: ['device-velha'],
      }),
    );
    const controller = new InternalMachineDeviceKeysController({
      execute,
    } as unknown as RegistrarChaveDeMaquinaUseCase);

    const resposta = await controller.registrarChave({
      name: 'servidor-de-casa',
      publicKeyJwk: '{"kty":"OKP","crv":"Ed25519","x":"ZGVhZGJlZWY"}',
    });

    expect(resposta).toEqual({
      id: 'device-1',
      userId: 'user-1',
      name: 'servidor-de-casa',
      createdAt: '2026-09-12T12:00:00.000Z',
      replacedKeyIds: ['device-velha'],
    });
  });

  it('o corpo NÃO carrega dono: o caso de uso recebe só nome e chave pública', async () => {
    const execute = vi.fn(() =>
      Promise.resolve({
        id: 'device-1',
        userId: 'user-1',
        name: 'servidor',
        createdAt: new Date('2026-09-12T12:00:00.000Z'),
        substituidas: [],
      }),
    );
    const controller = new InternalMachineDeviceKeysController({
      execute,
    } as unknown as RegistrarChaveDeMaquinaUseCase);

    await controller.registrarChave({
      name: 'servidor',
      publicKeyJwk: '{"kty":"OKP","crv":"Ed25519","x":"ZGVhZGJlZWY"}',
    });

    // Nenhuma chave a mais no argumento: um `userId` vindo do chamador é
    // exatamente a escolha de vítima que esta rota não pode oferecer.
    expect(execute).toHaveBeenCalledWith({
      name: 'servidor',
      publicKeyJwk: '{"kty":"OKP","crv":"Ed25519","x":"ZGVhZGJlZWY"}',
    });
  });
});

/**
 * A rota é `@ServiceRoute()` + `@UseGuards(EngineServiceGuard)`: quem a
 * protege é o segredo da instalação, e é a única coisa entre um scanner de
 * porta e uma credencial duradoura em nome de uma pessoa. Um teste do
 * controller sozinho não veria isso — daí exercitar o guard com o MESMO
 * cabeçalho que a rota declara, igual ao irmão da primeira conta.
 */
describe('InternalMachineDeviceKeysController — sem service token válido', () => {
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
