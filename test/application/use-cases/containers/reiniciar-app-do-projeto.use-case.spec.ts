import { describe, it, expect } from 'vitest';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ReiniciarAppDoProjetoUseCase } from '../../../../src/application/use-cases/containers/reiniciar-app-do-projeto.use-case';
import {
  BrokerIndisponivelError,
  BrokerRecusouError,
  type ContainerBrokerPort,
  type ResultadoDoReinicioDoApp,
} from '../../../../src/application/ports/container-broker.port';
import { EngineServiceGuard } from '../../../../src/interfaces/http/auth/engine-service.guard';
import { InternalProjectsController } from '../../../../src/interfaces/http/internal/internal-projects.controller';

const caso = (reiniciarApp: ContainerBrokerPort['reiniciarApp']) =>
  new ReiniciarAppDoProjetoUseCase({ reiniciarApp } as ContainerBrokerPort);

describe('ReiniciarAppDoProjetoUseCase (RN-1026)', () => {
  it.each<ResultadoDoReinicioDoApp>([
    { reiniciou: true },
    { reiniciou: false, motivo: 'sem_container' },
    { reiniciou: false, motivo: 'tempo_esgotado' },
    { reiniciou: false, motivo: 'app_saiu', exitCode: 3 },
  ])('repassa o resultado do broker sem acrescentar texto: %j', async (r) => {
    const resultado = await caso(() => Promise.resolve(r)).execute('p1');
    expect(resultado).toStrictEqual(r);
  });

  it('pede o reinício só com o projectId (o comando não viaja)', async () => {
    const chamadas: unknown[][] = [];
    await caso((...args) => {
      chamadas.push(args);
      return Promise.resolve({ reiniciou: true });
    }).execute('p1');
    expect(chamadas).toEqual([['p1']]);
  });

  it('projeto sem container (broker 404) dá sem_container', async () => {
    const r = await caso(() =>
      Promise.reject(new BrokerRecusouError(404, 'sem container x', 'codigo')),
    ).execute('p1');
    expect(r).toStrictEqual({ reiniciou: false, motivo: 'sem_container' });
  });

  it('broker 409 (sem run.app ou runner) dá sem_app', async () => {
    const r = await caso(() =>
      Promise.reject(new BrokerRecusouError(409, 'sem comando', 'codigo')),
    ).execute('p1');
    expect(r).toStrictEqual({ reiniciou: false, motivo: 'sem_app' });
  });

  it('broker que recusa ou não responde vira falha_no_exec, sem a mensagem dele', async () => {
    for (const erro of [
      new BrokerRecusouError(500, 'JWT_SECRET=abc', null),
      new BrokerIndisponivelError('sem-resposta', 'JWT_SECRET=abc'),
    ]) {
      const r = await caso(() => Promise.reject(erro)).execute('p1');
      expect(r).toStrictEqual({ reiniciou: false, motivo: 'falha_no_exec' });
    }
  });

  it('defeito de código segue lançando', async () => {
    await expect(
      caso(() => Promise.reject(new TypeError('bug'))).execute('p1'),
    ).rejects.toThrow('bug');
  });
});

describe('rota interna de reinício do app', () => {
  it('só o engine entra: o controller usa o EngineServiceGuard', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      InternalProjectsController,
    ) as unknown[];
    expect(guards).toContain(EngineServiceGuard);
  });

  it('quem chega sem o token do serviço é recusado', () => {
    const ctx = {
      switchToHttp: () => ({ getRequest: () => ({ headers: {} }) }),
    };
    expect(() => new EngineServiceGuard().canActivate(ctx as never)).toThrow();
  });
});
