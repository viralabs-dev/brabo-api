import { describe, it, expect } from 'vitest';
import { ExecutarComandoNoContainerUseCase } from '../../../../src/application/use-cases/containers/executar-comando-no-container.use-case';
import { RegistrarFalhaDeSubidaUseCase } from '../../../../src/application/use-cases/containers/registrar-falha-de-subida.use-case';
import {
  BrokerIndisponivelError,
  BrokerRecusouError,
  type ContainerBrokerPort,
} from '../../../../src/application/ports/container-broker.port';

function brokerFake(overrides: Partial<ContainerBrokerPort> = {}) {
  return {
    configurado: () => true,
    start: () =>
      Promise.resolve({
        containerId: 'c1',
        nome: 'brabo-x',
        jaEstavaDePe: false,
      }),
    stop: () => Promise.resolve(undefined),
    remove: () => Promise.resolve(undefined),
    inspect: () => Promise.resolve(null),
    exec: () => Promise.resolve({ exitCode: 0, output: 'ok', timedOut: false }),
    ...overrides,
  };
}

describe('ExecutarComandoNoContainerUseCase', () => {
  it('caminho feliz: devolve sucesso com exitCode/output/timedOut do broker', async () => {
    const broker = brokerFake({
      exec: (_projectId, comando, cwd, timeoutMs) => {
        expect(comando).toBe('npm test');
        expect(cwd).toBe('/work');
        expect(timeoutMs).toBe(120_000);
        return Promise.resolve({
          exitCode: 0,
          output: 'passou\n',
          timedOut: false,
        });
      },
    });
    const useCase = new ExecutarComandoNoContainerUseCase(broker);

    const resultado = await useCase.execute(
      'proj-1',
      'npm test',
      '/work',
      120_000,
    );

    expect(resultado).toEqual({
      sucesso: true,
      exitCode: 0,
      output: 'passou\n',
      timedOut: false,
    });
  });

  it('BrokerRecusouError vira resultado tipado de falha, nunca propaga', async () => {
    const broker = brokerFake({
      exec: () => {
        return Promise.reject(
          new BrokerRecusouError(
            422,
            'cwd "/etc" está fora de /work',
            'politica',
          ),
        );
      },
    });
    const useCase = new ExecutarComandoNoContainerUseCase(broker);

    const resultado = await useCase.execute(
      'proj-1',
      'cat /etc/passwd',
      '/etc',
    );

    expect(resultado).toEqual({
      sucesso: false,
      motivo: 'cwd "/etc" está fora de /work',
    });
  });

  it('BrokerIndisponivelError vira resultado tipado de falha, nunca propaga', async () => {
    const broker = brokerFake({
      exec: () => {
        return Promise.reject(
          new BrokerIndisponivelError('sem-resposta', 'timeout'),
        );
      },
    });
    const useCase = new ExecutarComandoNoContainerUseCase(broker);

    const resultado = await useCase.execute('proj-1', 'npm test');

    expect(resultado).toEqual({ sucesso: false, motivo: 'timeout' });
  });

  it('`teto-excedido` também vira falha tipada, com o texto que nomeia o teto (RN-604)', async () => {
    const texto =
      'o broker de container não respondeu `exec` dentro do teto desta operação (135000ms)';
    const broker = brokerFake({
      exec: () =>
        Promise.reject(new BrokerIndisponivelError('teto-excedido', texto)),
    });

    const resultado = await new ExecutarComandoNoContainerUseCase(
      broker,
    ).execute('proj-1', 'npm test', undefined, 90_000);

    expect(resultado).toEqual({ sucesso: false, motivo: texto });
  });

  it('erro que NÃO é do broker (defeito real) continua propagando — não é disfarçado de falha de comando', async () => {
    const broker = brokerFake({
      exec: () => {
        return Promise.reject(new TypeError('bug de verdade'));
      },
    });
    const useCase = new ExecutarComandoNoContainerUseCase(broker);

    await expect(useCase.execute('proj-1', 'npm test')).rejects.toThrow(
      'bug de verdade',
    );
  });

  it('cwd/timeoutMs ausentes são repassados como undefined ao broker (sem inventar default aqui)', async () => {
    const chamadas: Array<[string, string | undefined, number | undefined]> =
      [];
    const broker = brokerFake({
      exec: (_p, comando, cwd, timeoutMs) => {
        chamadas.push([comando, cwd, timeoutMs]);
        return Promise.resolve({ exitCode: 0, output: '', timedOut: false });
      },
    });
    const useCase = new ExecutarComandoNoContainerUseCase(broker);

    await useCase.execute('proj-1', 'npm test');

    expect(chamadas).toEqual([['npm test', undefined, undefined]]);
  });

  it('422 `servico_de_dados_morreu` grava o ciclo failed com a frase simples (RN-1538)', async () => {
    const gravadas: Array<[string, string]> = [];
    const broker = brokerFake({
      exec: () =>
        Promise.reject(
          new BrokerRecusouError(
            422,
            'db saiu',
            'broker',
            'servico_de_dados_morreu',
          ),
        ),
    });
    const falha = {
      execute: (p: string, m: string) => {
        gravadas.push([p, m]);
        return Promise.resolve();
      },
    } as unknown as RegistrarFalhaDeSubidaUseCase;

    const resultado = await new ExecutarComandoNoContainerUseCase(
      broker,
      undefined,
      falha,
    ).execute('proj-1', 'true');

    const motivo =
      'O ambiente do projeto reiniciou e o banco não voltou: db saiu';
    expect(resultado).toEqual({ sucesso: false, motivo });
    expect(gravadas).toEqual([['proj-1', motivo]]);
  });

  it('outro código do broker não grava o ciclo', async () => {
    let gravou = false;
    const broker = brokerFake({
      exec: () => Promise.reject(new BrokerRecusouError(422, 'x', 'politica')),
    });
    const falha = {
      execute: () => {
        gravou = true;
        return Promise.resolve();
      },
    } as unknown as RegistrarFalhaDeSubidaUseCase;

    await new ExecutarComandoNoContainerUseCase(
      broker,
      undefined,
      falha,
    ).execute('proj-1', 'true');

    expect(gravou).toBe(false);
  });
});
