import { describe, expect, it } from 'vitest';
import {
  Controller,
  Get,
  Module,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { Request, Response } from 'express';
import {
  aplicarOrigemEngine,
  OrigemEngineMiddleware,
} from '../../../src/infrastructure/http-clients/origem-engine.middleware';
import { veioDoEngine } from '../../../src/infrastructure/persistence/drizzle/drizzle-context';

/**
 * AT-157: `/internal/*` marca a escrita como "veio do engine" (a api não avisa
 * o canal de novo); qualquer outra rota não marca.
 */
function passaPor(path: string): boolean {
  let marcado = false;
  new OrigemEngineMiddleware().use({ path } as Request, {} as Response, () => {
    marcado = veioDoEngine();
  });
  return marcado;
}

describe('OrigemEngineMiddleware', () => {
  it('marca a origem engine em /internal/*', () => {
    expect(passaPor('/internal/sessions/abc/events')).toBe(true);
  });

  it('não marca rota de usuário nem prefixo parecido', () => {
    expect(passaPor('/projects/p/sessions/s/actions')).toBe(false);
    expect(passaPor('/internals/x')).toBe(false);
  });
});

@Controller()
class SondaController {
  @Get('internal/sonda')
  interna() {
    return { engine: veioDoEngine() };
  }

  @Get('projects/sonda')
  publica() {
    return { engine: veioDoEngine() };
  }
}

@Module({ controllers: [SondaController] })
class SondaModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    aplicarOrigemEngine(consumer);
  }
}

describe('aplicarOrigemEngine (roteamento real do Nest)', () => {
  it('a rota /internal/* enxerga a origem engine e a de usuário não', async () => {
    const modulo = await Test.createTestingModule({
      imports: [SondaModule],
    }).compile();
    const app = modulo.createNestApplication();
    await app.init();
    try {
      const interna = await request(app.getHttpServer()).get('/internal/sonda');
      const publica = await request(app.getHttpServer()).get('/projects/sonda');
      expect(interna.body).toEqual({ engine: true });
      expect(publica.body).toEqual({ engine: false });
    } finally {
      await app.close();
    }
  });
});
