import { describe, it, expect } from 'vitest';
import { validarPerguntaEmAberto } from '../../../src/domain/open-questions/pergunta-em-aberto';

// RN-1528: `opcoes` (até 2, rótulo na regra de linguagem) e `detalhe` opcionais.
const base = {
  questionId: '11111111-1111-4111-8111-111111111111',
  pergunta: 'Posso subir o banco no teste?',
  afeta: { regras: [], historias: [], tarefas: [] },
  autor: 'qa-lead',
  sessionId: 's1',
};

describe('opcoes e detalhe da pergunta em aberto (RN-1528)', () => {
  it('aceita 2 opções e detalhe, e sem eles o payload é o de antes', () => {
    const r = validarPerguntaEmAberto({
      ...base,
      opcoes: [
        { rotulo: 'Testar com banco (demora mais)', resposta: 'Suba o banco.' },
        { rotulo: 'Seguir sem esse teste', resposta: 'Pule o teste.' },
      ],
      detalhe: 'O compose sobe o postgres.',
    });
    expect(r.ok && r.valor.opcoes).toHaveLength(2);
    expect(r.ok && r.valor.detalhe).toBe('O compose sobe o postgres.');
    const sem = validarPerguntaEmAberto(base);
    expect(sem.ok && 'opcoes' in sem.valor).toBe(false);
  });
  it('recusa mais de 2 opções, rótulo com jargão, resposta vazia e detalhe longo', () => {
    const o = { rotulo: 'Seguir', resposta: 'ok' };
    expect(validarPerguntaEmAberto({ ...base, opcoes: [o, o, o] }).ok).toBe(
      false,
    );
    expect(
      validarPerguntaEmAberto({
        ...base,
        opcoes: [{ rotulo: 'rodar make_dev', resposta: 'ok' }],
      }).ok,
    ).toBe(false);
    expect(
      validarPerguntaEmAberto({
        ...base,
        opcoes: [{ rotulo: 'Seguir', resposta: ' ' }],
      }).ok,
    ).toBe(false);
    expect(
      validarPerguntaEmAberto({ ...base, detalhe: 'x'.repeat(2001) }).ok,
    ).toBe(false);
  });
});
