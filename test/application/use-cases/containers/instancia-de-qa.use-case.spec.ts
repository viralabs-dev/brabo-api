import { describe, expect, it } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { InstanciaDeQaUseCase } from '../../../../src/application/use-cases/containers/instancia-de-qa.use-case';
import {
  BrokerRecusouError,
  type ContainerBrokerPort,
} from '../../../../src/application/ports/container-broker.port';
import type {
  InstanciaDeQa,
  QaEnvironmentRepository,
} from '../../../../src/application/ports/qa-environment-repository.port';
import type { ProjectRepository } from '../../../../src/application/ports/project-repository.port';

const T1 = 'a1b2c3d4-0000-4000-8000-000000000001';
const T2 = 'e5f6a7b8-0000-4000-8000-000000000002';

function montar(modo = 'container', tarefas = [T1, T2]) {
  const linhas: InstanciaDeQa[] = [];
  const chamadas: string[] = [];
  let falhaStart = false;
  const repo = {
    resolverTarefas: (_p: string, ref: { id?: string; chave?: string }) =>
      Promise.resolve(
        tarefas.filter((t) =>
          ref.id ? t === ref.id : t.replace(/-/g, '').startsWith(ref.chave!),
        ),
      ),
    find: (p: string, t: string) =>
      Promise.resolve(
        linhas.find((l) => l.projectId === p && l.taskId === t) ?? null,
      ),
    findAtivaDoProjeto: (p: string) =>
      Promise.resolve(
        linhas.find(
          (l) =>
            l.projectId === p && ['provisioning', 'running'].includes(l.status),
        ) ?? null,
      ),
    listarParaLimpeza: () =>
      Promise.resolve(linhas.filter((l) => l.status !== 'removed')),
    criar: (projectId: string, taskId: string) => {
      const l = {
        id: `l${linhas.length}`,
        projectId,
        taskId,
        status: 'provisioning' as const,
      };
      linhas.push(l);
      return Promise.resolve(l);
    },
    atualizarStatus: (id: string, status: InstanciaDeQa['status']) => {
      const l = linhas.find((x) => x.id === id)!;
      l.status = status;
      return Promise.resolve(l);
    },
  } as unknown as QaEnvironmentRepository;
  const broker = {
    startQa: (_p: string, chave: string) => {
      chamadas.push(`start:${chave}`);
      return falhaStart
        ? Promise.reject(new BrokerRecusouError(409, 'sem imagem', 'politica'))
        : Promise.resolve({ containerId: 'c', nome: 'n', jaEstavaDePe: false });
    },
    removeQa: (_p: string, chave: string) => {
      chamadas.push(`remove:${chave}`);
      return Promise.resolve();
    },
  } as unknown as ContainerBrokerPort;
  const projects = {
    findById: () => Promise.resolve({ id: 'p1', executionMode: modo }),
  } as unknown as ProjectRepository;
  return {
    uc: new InstanciaDeQaUseCase(projects, repo, broker),
    linhas,
    chamadas,
    falhar: () => (falhaStart = true),
  };
}

describe('InstanciaDeQaUseCase (AT-612)', () => {
  it('sobe pela chave de 8 ou pelo id completo e remove', async () => {
    const { uc, chamadas, linhas } = montar();
    const r = await uc.start('p1', 'a1b2c3d4');
    expect(r).toMatchObject({
      sucesso: true,
      status: 'running',
      chave: 'a1b2c3d4',
    });
    expect(chamadas).toEqual(['start:a1b2c3d4']);
    await uc.remove('p1', T1);
    expect(linhas[0].status).toBe('removed');
    expect(chamadas).toContain('remove:a1b2c3d4');
  });

  it('segunda tarefa com a primeira ativa: 409 instancia_de_qa_ocupada', async () => {
    const { uc } = montar();
    await uc.start('p1', T1);
    await expect(uc.start('p1', T2)).rejects.toMatchObject({
      response: { code: 'instancia_de_qa_ocupada' },
    });
  });

  it('broker recusando vira sucesso:false e linha failed', async () => {
    const { uc, linhas, falhar } = montar();
    falhar();
    const r = await uc.start('p1', T1);
    expect(r).toMatchObject({ sucesso: false, status: 'failed' });
    expect(linhas[0].status).toBe('failed');
  });

  it('runner é recusado e tarefa de outro projeto é 404', async () => {
    await expect(montar('runner').uc.start('p1', T1)).rejects.toBeInstanceOf(
      ConflictException,
    );
    await expect(
      montar('container', []).uc.start('p1', T1),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('limpeza remove o que o engine não tem em voo', async () => {
    const { uc, linhas } = montar();
    await uc.start('p1', T1);
    expect(await uc.limparOrfas([T1])).toEqual({ removidas: [], falhas: [] });
    expect((await uc.limparOrfas([])).removidas).toEqual([T1]);
    expect(linhas[0].status).toBe('removed');
  });
});
