import { describe, it, expect, afterEach } from 'vitest';
import { Controller, Get, Res } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Response } from 'express';
import request from 'supertest';
import { etagDoCorpoVazio } from '../../../../src/interfaces/http/shared/etag-do-corpo-vazio';

/**
 * AT-093 (RN-579): `GET .../sessions/:id/budget` voltou 304 em 0% de 483
 * chamadas na instalação medida. A causa não era campo volátil: handler que
 * devolve `null` sai com corpo vazio e SEM `ETag`, e sem validador o 304 é
 * impossível. Este teste sobe o Nest de verdade (o mesmo `ExpressAdapter`
 * que produção usa) para provar a causa e a correção pela MESMA rota.
 */

@Controller()
class RotasDeTeste {
  @Get('nulo')
  nulo() {
    return null;
  }

  @Get('objeto')
  objeto() {
    return { limite: 10 };
  }

  // Handler com `@Res()`: devolve `undefined` e escreve o corpo DEPOIS. É o
  // caso que um interceptor erraria (gravaria o `ETag` do vazio num corpo
  // que não é vazio) — e o motivo de a correção morar no `send`.
  @Get('res-tardio')
  resTardio(@Res() res: Response) {
    setTimeout(() => res.send('corpo escrito depois'), 5);
  }
}

let app: NestExpressApplication | undefined;

async function subir(comCorrecao: boolean) {
  const modulo = await Test.createTestingModule({
    controllers: [RotasDeTeste],
  }).compile();
  app = modulo.createNestApplication<NestExpressApplication>({ logger: false });
  if (comCorrecao) app.use(etagDoCorpoVazio());
  await app.init();
  return app.getHttpServer();
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('ETag do corpo vazio (RN-579)', () => {
  it('a CAUSA, medida: sem a correção, `null` sai sem ETag e o 304 é impossível', async () => {
    const servidor = await subir(false);
    const primeira = await request(servidor).get('/nulo');
    expect(primeira.status).toBe(200);
    expect(primeira.headers.etag).toBeUndefined();

    // O que o navegador faria na segunda busca, se tivesse um validador.
    const segunda = await request(servidor)
      .get('/nulo')
      .set('If-None-Match', 'W/"0-2jmj7l5rSw0yVb/vlWAYkK/YBwk"');
    expect(segunda.status).toBe(200);
  });

  it('caminho feliz: com a correção, `null` ganha ETag e a segunda busca volta 304', async () => {
    const servidor = await subir(true);
    const primeira = await request(servidor).get('/nulo');
    expect(primeira.status).toBe(200);
    expect(primeira.text).toBe('');
    const etag = primeira.headers.etag;
    expect(etag).toMatch(/^W\/"0-/);

    const segunda = await request(servidor)
      .get('/nulo')
      .set('If-None-Match', etag);
    expect(segunda.status).toBe(304);
  });

  it('corpo não-nulo continua com o ETag do PRÓPRIO corpo (o do Express, intocado)', async () => {
    const servidor = await subir(true);
    const primeira = await request(servidor).get('/objeto');
    const vazio = (await request(servidor).get('/nulo')).headers.etag;
    expect(primeira.headers.etag).toBeDefined();
    expect(primeira.headers.etag).not.toBe(vazio);

    // O validador do vazio NÃO serve a um corpo que não é vazio.
    const cruzada = await request(servidor)
      .get('/objeto')
      .set('If-None-Match', vazio);
    expect(cruzada.status).toBe(200);
    expect(cruzada.body).toEqual({ limite: 10 });
  });

  it('CASO DE FALHA evitado: handler com @Res() que escreve depois não herda o ETag do vazio', async () => {
    const servidor = await subir(true);
    const vazio = (await request(servidor).get('/nulo')).headers.etag;
    const resposta = await request(servidor)
      .get('/res-tardio')
      .set('If-None-Match', vazio);
    expect(resposta.status).toBe(200);
    expect(resposta.text).toBe('corpo escrito depois');
    expect(resposta.headers.etag).not.toBe(vazio);
  });
});
