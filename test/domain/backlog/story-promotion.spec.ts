import { describe, it, expect } from 'vitest';
import {
  assertPromotable,
  isPromotable,
  missingForPromotion,
  type StoryPromotionView,
} from '../../../src/domain/backlog/story-promotion';
import { StoryNotReadyError } from '../../../src/domain/backlog/story-readiness';
import { StoryModulesMissingError } from '../../../src/domain/architecture/module-resolution';

function story(over: Partial<StoryPromotionView> = {}): StoryPromotionView {
  return {
    dod: ['testes passando'],
    dor: ['critério claro'],
    rf: ['RF-1'],
    businessRuleIds: ['evt-r1'],
    moduleIds: [],
    ...over,
  };
}

const MODULOS = ['api', 'web'];

describe('assertPromotable', () => {
  it('story completa passa', () => {
    expect(() => assertPromotable(story(), MODULOS)).not.toThrow();
  });

  it('prontidão vem primeiro — é a falha que o autor corrige sozinho', () => {
    // Com DoD faltando E módulo inexistente, o erro relatado é o de
    // prontidão: depender do Arquiteto é o problema seguinte, não o
    // primeiro.
    expect(() =>
      assertPromotable(story({ dod: [], moduleIds: ['fantasma'] }), MODULOS),
    ).toThrow(StoryNotReadyError);
  });

  it('módulo fora do module_map vigente barra a promoção', () => {
    expect(() =>
      assertPromotable(story({ moduleIds: ['api', 'fantasma'] }), MODULOS),
    ).toThrow(StoryModulesMissingError);
  });

  it('moduleIds VAZIO passa — sem isso o modo auto nunca promoveria nada', () => {
    // Na criação a story ainda não tem módulos (quem atribui é o Arquiteto,
    // depois). Se vazio barrasse, ligar esta validação ao caminho de criação
    // quebraria o modo `auto` em silêncio.
    expect(() =>
      assertPromotable(story({ moduleIds: [] }), MODULOS),
    ).not.toThrow();
  });

  it('cada requisito de prontidão isoladamente barra', () => {
    for (const campo of ['dod', 'dor', 'rf', 'businessRuleIds'] as const) {
      expect(() => assertPromotable(story({ [campo]: [] }), MODULOS)).toThrow(
        StoryNotReadyError,
      );
    }
  });
});

describe('simetria entre os modos (requisito 3 da Fase 12c)', () => {
  // O modo do projeto muda QUEM dispara a promoção — nunca O QUE é validado.
  // Este bloco é o que impede as duas portas de voltarem a ter fechaduras
  // diferentes, que era exatamente o estado anterior à 12c: a criação
  // chamava só `canBecomeReady`, a transição chamava mais duas coisas.
  //
  // Os dois modos chamam ESTA função; simular "o modo" aqui seria teatro.
  // O que se prova é que a função é única e determinística — e os specs de
  // `create-story` (modo auto) e `promote-stories` (modo manual) asseguram
  // que ambos passam por ela.
  const casos: { nome: string; story: StoryPromotionView }[] = [
    { nome: 'sem DoD', story: story({ dod: [] }) },
    { nome: 'sem DoR', story: story({ dor: [] }) },
    { nome: 'sem RF', story: story({ rf: [] }) },
    { nome: 'sem regra de negócio', story: story({ businessRuleIds: [] }) },
    { nome: 'módulo inexistente', story: story({ moduleIds: ['fantasma'] }) },
    { nome: 'completa', story: story({ moduleIds: ['api'] }) },
  ];

  it.each(casos)(
    'o veredito de $nome não depende de por onde a promoção entra',
    ({ story: s }) => {
      // `isPromotable` é o que a criação em auto consulta; `assertPromotable`
      // é o que a promoção manual chama. Os dois têm de concordar SEMPRE —
      // divergir aqui significaria uma story promovível por um caminho e
      // não pelo outro.
      let levantou = false;
      try {
        assertPromotable(s, MODULOS);
      } catch {
        levantou = true;
      }

      expect(isPromotable(s, MODULOS)).toBe(!levantou);
    },
  );
});

describe('missingForPromotion', () => {
  it('separa o que é do autor do que é do Arquiteto', () => {
    expect(
      missingForPromotion(
        story({ dod: [], dor: [], moduleIds: ['fantasma'] }),
        MODULOS,
      ),
    ).toEqual({ readiness: ['dod', 'dor'], modules: ['fantasma'] });
  });

  it('story completa não tem pendência nenhuma', () => {
    expect(missingForPromotion(story({ moduleIds: ['api'] }), MODULOS)).toEqual(
      {
        readiness: [],
        modules: [],
      },
    );
  });
});
