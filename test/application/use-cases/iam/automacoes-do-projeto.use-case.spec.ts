import { describe, it, expect } from 'vitest';
import { AutomacoesDoProjetoUseCase } from '../../../../src/application/use-cases/iam/automacoes-do-projeto.use-case';

/** RN-1421 (AT-994): sem linha a passagem vale LIGADA; só chaves conhecidas. */
function criar(linhas: object[] = []) {
  const gravadas: object[] = [];
  const uc = new AutomacoesDoProjetoUseCase({
    listar: () => Promise.resolve([...linhas, ...gravadas]),
    definir: (i: object) => {
      gravadas.push({ ...i, createdAt: new Date() });
      return Promise.resolve();
    },
  } as never);
  return uc;
}

describe('AutomacoesDoProjetoUseCase (RN-1421)', () => {
  it('sem linha, as duas passagens estão ligadas por padrão', async () => {
    const uc = criar();
    expect(await uc.passagemLigada('p', 'arquiteto->infra')).toBe(true);
    expect(
      (await uc.listar('p')).map((a) => [a.chave, a.ligada, a.origem]),
    ).toEqual([
      ['arquiteto->infra', true, 'padrao'],
      ['infra->dev-lead', true, 'padrao'],
    ]);
  });

  it('desligar grava e passa a valer; a outra passagem segue ligada', async () => {
    const uc = criar();
    await uc.definir('p', 'u', 'handoff', 'arquiteto->infra', false);
    expect(await uc.passagemLigada('p', 'arquiteto->infra')).toBe(false);
    expect(await uc.passagemLigada('p', 'infra->dev-lead')).toBe(true);
  });

  it('chave desconhecida é 400', async () => {
    await expect(
      criar().definir('p', 'u', 'handoff', 'po->arquiteto', false),
    ).rejects.toThrow('Automação desconhecida');
  });
});
