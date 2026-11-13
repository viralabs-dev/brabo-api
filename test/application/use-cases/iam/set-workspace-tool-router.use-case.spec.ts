import { describe, expect, it } from 'vitest';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { SetWorkspaceToolRouterUseCase } from '../../../../src/application/use-cases/iam/set-workspace-tool-router.use-case';
import type { SituacaoDoLaya } from '../../../../src/application/ports/roteador-local.port';

const situacao = (estado: SituacaoDoLaya['estado']): SituacaoDoLaya => ({
  estado,
  motivo: estado === 'proficiente' ? null : 'x',
  desde: '2026-11-09T00:00:00.000Z',
  dispositivo: null,
  vramLivreMiB: null,
  p95Ms: null,
});

function montar(estado: SituacaoDoLaya['estado']) {
  const gravados: string[] = [];
  const frescos: (boolean | undefined)[] = [];
  const uc = new SetWorkspaceToolRouterUseCase(
    {
      setToolRouter: (_id: string, r: string) => {
        gravados.push(r);
        return Promise.resolve({ id: 'w', toolRouter: r });
      },
    } as never,
    {
      situacao: (fresco?: boolean) => {
        frescos.push(fresco);
        return Promise.resolve(situacao(estado));
      },
    },
  );
  return { uc, gravados, frescos };
}

describe('SetWorkspaceToolRouterUseCase', () => {
  it('laya sem o serviço proficiente: 409 roteador_local_indisponivel, nada gravado', async () => {
    const { uc, gravados } = montar('sem_resposta');
    const erro: unknown = await uc
      .execute('w', { roteador: 'laya' })
      .catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ConflictException);
    expect((erro as ConflictException).getResponse()).toMatchObject({
      code: 'roteador_local_indisponivel',
      estado: 'sem_resposta',
    });
    expect(gravados).toEqual([]);
  });

  it('laya com o serviço proficiente: grava, confirmando na hora (sem cache)', async () => {
    const { uc, gravados, frescos } = montar('proficiente');
    await uc.execute('w', { roteador: 'laya' });
    expect(gravados).toEqual(['laya']);
    expect(frescos).toEqual([true]);
  });

  it('o booleano antigo segue valendo e não consulta o Laya', async () => {
    const { uc, gravados, frescos } = montar('sem_gpu');
    await uc.execute('w', { enabled: false });
    await uc.execute('w', { enabled: true });
    expect(gravados).toEqual(['desligado', 'jev']);
    expect(frescos).toEqual([]);
  });

  it('sem roteador nem enabled: 400', async () => {
    await expect(
      montar('proficiente').uc.execute('w', {}),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
