import { describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import {
  opcoesDaLeituraInterna,
  TETO_DE_TIPOS_POR_LEITURA,
} from '../../../../src/interfaces/http/internal/leitura-interna-de-eventos';

/**
 * RN-580 — a rota interna de eventos ganhou `latest` e `types`, ADITIVOS. O
 * engine lia os PRIMEIROS 200 eventos porque a rota nem aceitava `latest`.
 */
describe('opcoesDaLeituraInterna (GET /internal/sessions/:id/events)', () => {
  it('sem os parâmetros novos, as opções são as de antes', () => {
    expect(opcoesDaLeituraInterna({ limit: '200' })).toEqual({
      afterSeq: undefined,
      limit: 200,
      latest: false,
    });
  });

  it('latest=true pede a cauda; types vira lista, com espaços e vazios descartados', () => {
    expect(
      opcoesDaLeituraInterna({
        limit: '200',
        latest: 'true',
        types: 'artifact.product_brief, artifact.business_rule,,',
      }),
    ).toEqual({
      afterSeq: undefined,
      limit: 200,
      latest: true,
      types: ['artifact.product_brief', 'artifact.business_rule'],
    });
  });

  it('types vazio é o mesmo que ausente — não filtra tudo para fora', () => {
    expect(opcoesDaLeituraInterna({ types: '' })).not.toHaveProperty('types');
  });

  it('recusa tipo malformado com 400, em vez de devolver uma página vazia', () => {
    expect(() =>
      opcoesDaLeituraInterna({ types: "chat.message' OR 1=1" }),
    ).toThrow(BadRequestException);
  });

  it(`recusa mais de ${TETO_DE_TIPOS_POR_LEITURA} tipos`, () => {
    const muitos = Array.from(
      { length: TETO_DE_TIPOS_POR_LEITURA + 1 },
      (_, i) => `tipo.t${i}`,
    ).join(',');
    expect(() => opcoesDaLeituraInterna({ types: muitos })).toThrow(
      /no máximo 20/,
    );
  });
});
