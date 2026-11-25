import { describe, expect, it } from 'vitest';
import { GetArchitectureUseCase } from '../../../../src/application/use-cases/architecture/get-architecture.use-case';

// AT-981 (RN-1352): a leitura da arquitetura traz os contratos vigentes.
describe('GetArchitectureUseCase: contratos', () => {
  const contratos = [
    {
      modulo: 'agenda',
      expoe: [{ tipo: 'tabela', assinatura: 'agendamento(id)', descricao: '' }],
    },
  ];
  const montar = (lidos: unknown[]) =>
    new GetArchitectureUseCase(
      { findCurrent: () => Promise.resolve(null) } as never,
      { findByProject: () => Promise.resolve([]) } as never,
      { listByProjectAndType: () => Promise.resolve([]) } as never,
      { execute: () => Promise.resolve({ status: 'sem_diagrama' }) } as never,
      { execute: () => Promise.resolve({ contratos: lidos }) } as never,
    );

  it('devolve os contratos do artefato vigente', async () => {
    const r = await montar(contratos).execute('p');
    expect(r.contratos).toEqual(contratos);
  });

  it('sem contrato declarado, lista vazia', async () => {
    expect((await montar([]).execute('p')).contratos).toEqual([]);
  });
});
