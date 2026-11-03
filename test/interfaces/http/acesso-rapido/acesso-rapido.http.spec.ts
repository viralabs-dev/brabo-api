import { afterEach, describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { Module, ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AcessoRapidoHttpModule } from '../../../../src/interfaces/http/acesso-rapido/acesso-rapido-http.module';
import { AcessoRapidoController } from '../../../../src/interfaces/http/acesso-rapido/acesso-rapido.controller';
import { AcessoRapidoUseCase } from '../../../../src/application/use-cases/acesso-rapido/acesso-rapido.use-case';

const execute = vi.fn((papel: string) =>
  Promise.resolve({
    accessToken: `at-${papel}`,
    refreshToken: 'rt',
    expiresIn: 900,
    locale: 'pt-BR',
  }),
);

// Mesmo desenho do módulo `local`, com o caso de uso trocado (sem banco).
@Module({
  controllers: [AcessoRapidoController],
  providers: [{ provide: AcessoRapidoUseCase, useValue: { execute } }],
})
class ModuloLocalDeTeste {}

let app: INestApplication;
afterEach(async () => {
  await app?.close();
  execute.mockClear();
});

async function subir(modulo: unknown) {
  const ref = await Test.createTestingModule({
    imports: [modulo as never],
  }).compile();
  app = ref.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
  await app.init();
  return request(app.getHttpServer() as never);
}

describe('/auth/dev-login (AT-722)', () => {
  it('fora de local o módulo é vazio: as duas rotas dão 404', () => {
    const vazio = AcessoRapidoHttpModule.registrar(false);
    expect(vazio.controllers ?? []).toHaveLength(0);
    expect(vazio.providers ?? []).toHaveLength(0);
  });

  it('fora de local, sem controller montado: 404 nas duas', async () => {
    @Module({})
    class Vazio {}
    const http = await subir(Vazio);
    await http.get('/auth/dev-login').expect(404);
    await http.post('/auth/dev-login').send({ papel: 'owner' }).expect(404);
  });

  it('em local o módulo registra o controller', () => {
    const ligado = AcessoRapidoHttpModule.registrar(true);
    expect(ligado.controllers).toEqual([AcessoRapidoController]);
  });

  it('GET lista os papéis do ROLE_ORDER com <papel>@brabo.dev', async () => {
    const http = await subir(ModuloLocalDeTeste);
    const res = await http.get('/auth/dev-login').expect(200);
    expect(res.body).toEqual({
      papeis: [
        { papel: 'owner', email: 'owner@brabo.dev' },
        { papel: 'maintainer', email: 'maintainer@brabo.dev' },
        { papel: 'developer', email: 'developer@brabo.dev' },
        { papel: 'viewer', email: 'viewer@brabo.dev' },
      ],
    });
  });

  it('POST emite a sessão do papel certo, com o cookie de refresh', async () => {
    const http = await subir(ModuloLocalDeTeste);
    const res = await http
      .post('/auth/dev-login')
      .send({ papel: 'developer' })
      .expect(200);
    expect(res.body).toEqual({
      accessToken: 'at-developer',
      expiresIn: 900,
      locale: 'pt-BR',
    });
    expect(execute).toHaveBeenCalledWith('developer', expect.anything());
    expect(String(res.headers['set-cookie'])).toMatch(/httponly/i);
  });

  it.each([{ papel: 'admin' }, { papel: 'x@y.com' }, {}])(
    'papel inválido %j: 400 e nenhum caso de uso',
    async (corpo) => {
      const http = await subir(ModuloLocalDeTeste);
      await http.post('/auth/dev-login').send(corpo).expect(400);
      expect(execute).not.toHaveBeenCalled();
    },
  );
});
