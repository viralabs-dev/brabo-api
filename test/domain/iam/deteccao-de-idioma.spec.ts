import { describe, expect, it } from 'vitest';
import {
  AT080,
  PARAMETROS_AT080,
  PARAMETROS_PROVISORIOS,
  evidenciasDoAutor,
  idiomaConcordante,
  mensagensNecessarias,
} from '../../../src/domain/iam/heuristica-de-idioma';
import {
  idiomaAPerguntar,
  subtagDeIdioma,
} from '../../../src/domain/iam/deteccao-de-idioma';

/**
 * A detecção do idioma do autor (AT-163, RN-624): a histerese refeita sem
 * estado, a evidência do autor e quando há pergunta. Os textos são sintéticos
 * — mensagem real de usuário nunca entra em fixture.
 */

const ES =
  '¿Puedes revisar por qué falla la prueba? Gracias, pero ahora no entiendo muy bien cómo funciona la configuración del proyecto con usted.';
const ES_2 =
  'Hola, también quiero saber cómo cambiar la versión. Entonces, ¿qué hago ahora? Muchas gracias por la explicación, es muy útil.';
const PT =
  'Você pode ver por que o teste não passa? Então, isso também acontece na configuração, obrigado pela ajuda com a migração das funções.';

describe('parâmetros provisórios (RN-624)', () => {
  it('só a evidência mínima difere dos candidatos da AT-080 — o resto é o da especificação', () => {
    expect(PARAMETROS_PROVISORIOS).toEqual({
      ...PARAMETROS_AT080,
      minPalavras: 10,
    });
  });

  it('a detecção lê a janela mais as avaliações que a histerese refaz', () => {
    expect(mensagensNecessarias(PARAMETROS_PROVISORIOS)).toBe(11);
  });
});

describe('idiomaConcordante — a histerese sem estado', () => {
  it('duas avaliações seguidas em espanhol concordam', () => {
    expect(idiomaConcordante([ES, ES_2], AT080, PARAMETROS_PROVISORIOS)).toBe(
      'es',
    );
  });

  it('UMA mensagem só não basta: a histerese pede duas avaliações', () => {
    expect(idiomaConcordante([ES], AT080, PARAMETROS_PROVISORIOS)).toBeNull();
  });

  it('texto curto ou sem idioma ("ok", código) é indeterminado e não aponta nada', () => {
    expect(
      idiomaConcordante(['ok', 'valeu'], AT080, PARAMETROS_PROVISORIOS),
    ).toBeNull();
    expect(
      idiomaConcordante(
        ['```\nconst x = 1;\n```', '```\nfoo()\n```'],
        AT080,
        PARAMETROS_PROVISORIOS,
      ),
    ).toBeNull();
  });

  it('uma mensagem em espanhol numa janela portuguesa não vira espanhol', () => {
    expect(
      idiomaConcordante([PT, PT, PT, ES], AT080, PARAMETROS_PROVISORIOS),
    ).not.toBe('es');
  });

  it('sem mensagens, nada', () => {
    expect(idiomaConcordante([], AT080, PARAMETROS_PROVISORIOS)).toBeNull();
  });
});

describe('evidenciasDoAutor — itens 5 e 6 da limpeza', () => {
  it('no formulário entram só as RESPOSTAS; o eco com os rótulos do agente é pulado', () => {
    const eventos = [
      {
        tipo: 'chat.structured_question_answered',
        payload: { answers: { q1: 'resposta um', q2: 'resposta dois' } },
        s: 'a',
      },
      {
        tipo: 'chat.message',
        payload: { text: '1. Rótulo do agente: resposta um' },
        s: 'a',
      },
      { tipo: 'chat.message', payload: { text: 'mensagem livre' }, s: 'a' },
      { tipo: 'chat.message', payload: { text: '   ' }, s: 'a' },
    ];

    const saida = evidenciasDoAutor(eventos, (e) => e.s);

    expect(saida.map((e) => [e.caso, e.texto])).toEqual([
      ['formulario', 'resposta um\nresposta dois'],
      ['chat', 'mensagem livre'],
    ]);
  });
});

describe('idiomaAPerguntar (RN-624)', () => {
  const interfacePt = { idioma: 'pt-BR', origem: 'interface' as const };

  it('pergunta quando o detectado diverge do efetivo que veio da interface', () => {
    expect(
      idiomaAPerguntar({
        detectado: 'es',
        efetivo: interfacePt,
        recusados: [],
      }),
    ).toBe('es');
  });

  it('não pergunta quando a detecção é indeterminada', () => {
    expect(
      idiomaAPerguntar({
        detectado: null,
        efetivo: interfacePt,
        recusados: [],
      }),
    ).toBeNull();
  });

  it('compara a SUBTAG: `pt` detectado não diverge de `pt-BR`', () => {
    expect(subtagDeIdioma('pt-BR')).toBe('pt');
    expect(
      idiomaAPerguntar({
        detectado: 'pt',
        efetivo: interfacePt,
        recusados: [],
      }),
    ).toBeNull();
  });

  it('não pergunta sobre escolha EXPLÍCITA — sessão ou Conta vencem o detectado', () => {
    for (const origem of ['sessao', 'conta'] as const) {
      expect(
        idiomaAPerguntar({
          detectado: 'es',
          efetivo: { idioma: 'pt-BR', origem },
          recusados: [],
        }),
      ).toBeNull();
    }
  });

  it('pergunta de novo quando o efetivo é um detectado confirmado ANTES e a língua mudou', () => {
    expect(
      idiomaAPerguntar({
        detectado: 'en',
        efetivo: { idioma: 'es', origem: 'detectado' },
        recusados: [],
      }),
    ).toBe('en');
  });

  it('não pergunta de novo o idioma que a pessoa recusou', () => {
    expect(
      idiomaAPerguntar({
        detectado: 'es',
        efetivo: interfacePt,
        recusados: ['es'],
      }),
    ).toBeNull();
  });
});
