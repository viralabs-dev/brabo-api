import { describe, it, expect } from 'vitest';
import {
  TETO_DA_CAUSA,
  recusaDeFraseParaLeigo,
} from '../../../src/domain/linguagem/frase-para-leigo';
import { validarExplicacaoDoBloqueio } from '../../../src/domain/backlog/explicacao-do-bloqueio';

// RN-1526 — a MESMA tabela de casos do engine (frases reais da 30ª).
const NEGATIVOS = [
  'package-lock.json da raiz alterado pelo npm install',
  'ECONNREFUSED 127.0.0.1:5432',
  'desfechos (commit, push): [:refused, :executed]',
  'app_saiu (código 1)… Missing script: build',
  'run.qa.services',
  'a'.repeat(64),
  'O teste falhou. O agente parou.',
  'Veja o `package.json`',
  'Falha em /home/dev/app',
  'Imagem 0f3a9c1d2e4b não existe',
  'O erro 502 voltou',
];

const POSITIVOS = [
  'O app não subiu no teste e o agente precisa de uma decisão sua.',
  'O agente parou e precisa de você para continuar.',
  'A instância de teste não está disponível agora.',
  'O commit da correção foi recusado.',
  'A conexão com o provedor caiu e volta sozinha.',
  'O limite de tentativas do agente foi atingido.',
  'O orçamento da tarefa acabou.',
  'O crédito do provedor de IA acabou.',
  'Concluir sem subir o app',
  'Tentar de novo',
  'Seguir sem esse teste',
];

describe('recusaDeFraseParaLeigo (RN-1526)', () => {
  it.each(NEGATIVOS)('recusa: %s', (t) => {
    expect(recusaDeFraseParaLeigo(t, TETO_DA_CAUSA)).not.toBeNull();
  });
  it.each(POSITIVOS)('aceita: %s', (t) => {
    expect(recusaDeFraseParaLeigo(t, TETO_DA_CAUSA)).toBeNull();
  });
  it('recusa vazio e acima do teto', () => {
    expect(recusaDeFraseParaLeigo('  ', 160)).not.toBeNull();
    expect(recusaDeFraseParaLeigo(undefined, 160)).not.toBeNull();
    expect(recusaDeFraseParaLeigo('x'.repeat(41), 40)).not.toBeNull();
  });
});

describe('validarExplicacaoDoBloqueio (RN-1526)', () => {
  const boa = {
    codigo: 'qa_instancia_indisponivel',
    causa: 'A instância de teste não está disponível agora.',
    acoes: [{ rotulo: 'Tentar de novo', orientacao: '' }],
  };
  it('aceita 1 ou 2 ações, com orientação vazia', () => {
    expect(validarExplicacaoDoBloqueio(boa).ok).toBe(true);
    const duas = {
      ...boa,
      acoes: [
        ...boa.acoes,
        { id: 'b', rotulo: 'Deixar para o fim', orientacao: 'x' },
      ],
    };
    expect(validarExplicacaoDoBloqueio(duas).ok).toBe(true);
  });
  it('recusa causa fora da regra, 0 ou 3 ações, rótulo ruim e não-objeto', () => {
    const r = (v: unknown) => validarExplicacaoDoBloqueio(v).ok;
    expect(r({ ...boa, causa: NEGATIVOS[0] })).toBe(false);
    expect(r({ ...boa, acoes: [] })).toBe(false);
    expect(
      r({ ...boa, acoes: [boa.acoes[0], boa.acoes[0], boa.acoes[0]] }),
    ).toBe(false);
    expect(
      r({ ...boa, acoes: [{ rotulo: 'rodar make_dev', orientacao: '' }] }),
    ).toBe(false);
    expect(
      r({ ...boa, acoes: [{ rotulo: 'Ok', orientacao: 'x'.repeat(2001) }] }),
    ).toBe(false);
    expect(r(null)).toBe(false);
    expect(r('texto')).toBe(false);
  });
});
