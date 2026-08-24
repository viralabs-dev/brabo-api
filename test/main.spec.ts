import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { tokenDeServicoAtual } from '../src/infrastructure/security/service-token';
import { CABECALHO_SERVICE_TOKEN } from '../src/interfaces/http/auth/engine-service.guard';

/**
 * Limite do body parser JSON (`src/main.ts`) — a causa do `413
 * "request entity too large"` no gate de QA/SecOps quando o engine manda o
 * histórico inteiro da conversa em `POST /internal/sessions/:id/llm-turn`. O
 * Nest nunca configurou um limite explícito; valia o default do Express
 * (100 KB), muito abaixo dos 8 MB que o Phoenix já aceita do lado do engine.
 *
 * `main.ts` não exporta `bootstrap()` (ele roda como efeito colateral do
 * import, com `app.listen` incluído), então não dá para importar a função de
 * lá sem subir um servidor de verdade num teste. A linha abaixo —
 * `app.useBodyParser('json', { limit })` — é a MESMA de `src/main.ts`,
 * replicada aqui de propósito; se o valor do default mudar lá, este teste
 * também precisa mudar (mesmo acoplamento que `security-headers.spec.ts` tem
 * com `helmetOptions`, só que sem poder importar a função porque o parser
 * mora no bootstrap, não numa peça extraída).
 *
 * O `AppModule` inteiro sobe (mesmo padrão de `route-surface.spec.ts`) porque
 * o que importa aqui é o corpo chegar ATÉ o caso de uso de verdade — só
 * checar a config do parser em isolado não provaria que nada no meio do
 * caminho (guard, pipe) reintroduz um limite menor. `DATABASE_URL` é
 * apontada explicitamente para a base de TESTE (mesma robustez de
 * `test-db.ts`) porque o processo pode ter `DATABASE_URL` mirando a base de
 * dev — e diferente de `route-surface.spec.ts` (que só enumera rotas via
 * `DiscoveryService`), este teste faz uma chamada real que bate no banco.
 *
 * `AppModule` é importado DINAMICAMENTE (`await import(...)`) dentro do
 * `beforeAll`, DEPOIS de `process.env.DATABASE_URL` já estar setado — nunca
 * como `import` estático no topo do arquivo. `DrizzleModule` cria seu pool
 * (`createDrizzleClient()`) em escopo de MÓDULO, não numa factory do Nest —
 * roda uma vez, na primeira vez que o módulo é carregado, não a cada
 * `Test.createTestingModule().compile()`. Um `import` estático avalia essa
 * linha ANTES de qualquer código do `beforeAll` rodar, e o pool nasceria
 * apontando pro default de `createDrizzleClient()` — a base de DEV, não
 * `brabo_test`. Achado por execução real: mascarado enquanto a base de dev
 * local também estava migrada (mesmo schema, então a query "achava" a
 * tabela mesmo assim); destravou assim que a base de dev foi recriada vazia.
 */

const SESSION_ID_OK = '00000000-0000-4000-8000-000000000001';
const SESSION_ID_413 = '00000000-0000-4000-8000-000000000002';
const PROJECT_ID_INEXISTENTE = '00000000-0000-4000-8000-000000000000';
const LIMITE_DO_TESTE = '2mb'; // pequeno de propósito — o teste não precisa mandar 10 MB pra provar o mecanismo.

function rota(sessionId: string) {
  return `/internal/sessions/${sessionId}/llm-turn`;
}

/** Corpo cujo tamanho serializado passa perto de `tamanhoAproxBytes`. */
function corpoDeTamanho(tamanhoAproxBytes: number) {
  return {
    projectId: PROJECT_ID_INEXISTENTE,
    messages: [{ role: 'user', content: 'a'.repeat(tamanhoAproxBytes) }],
  };
}

describe('main.ts — limite do body parser JSON (achado 413 engine→api)', () => {
  let modulo: TestingModule;
  let app: NestExpressApplication;

  beforeAll(async () => {
    process.env.DATABASE_URL =
      process.env.TEST_DATABASE_URL ??
      'postgres://brabo:brabo@localhost:5432/brabo_test';
    process.env.API_JSON_BODY_LIMIT = LIMITE_DO_TESTE;

    // Extensão `.js` explícita: sob `moduleResolution: nodenext`, o
    // TypeScript resolve `import()` DINÂMICO com a regra estrita de ESM
    // (especificador relativo precisa de extensão), mesmo o pacote sendo
    // CommonJS — mapeia de volta pro `.ts` só para checagem de tipo.
    const { AppModule } = await import('../src/app.module.js');
    modulo = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = modulo.createNestApplication<NestExpressApplication>();
    // Mesma linha de `src/main.ts`, ANTES de `app.init()` — é o que faz o
    // Nest não registrar por baixo dos panos o parser default de 100 KB (ele
    // detecta o parser já aplicado pelo nome interno e não duplica).
    app.useBodyParser('json', { limit: process.env.API_JSON_BODY_LIMIT });
    await app.init();
  }, 30_000);

  afterAll(async () => {
    delete process.env.API_JSON_BODY_LIMIT;
    await app?.close();
  });

  it('body de ~1 MB, sob o limite configurado, é ACEITO — não recebe 413', async () => {
    const resposta = await request(app.getHttpServer())
      .post(rota(SESSION_ID_OK))
      .set(CABECALHO_SERVICE_TOKEN, tokenDeServicoAtual())
      .send(corpoDeTamanho(1_000_000));

    expect(resposta.status).not.toBe(413);
    // Projeto inexistente: `ResolveModelBindingUseCase` devolve `null` e o
    // caso de uso responde 201 com `error` preenchido — SEM tentar gravar
    // `token_usage` (RN de contabilidade não se aplica: o turno nem achou
    // modelo). É a prova de que o corpo chegou INTEIRO ao caso de uso, e não
    // só que o parser não rejeitou a requisição antes de lê-la.
    expect(resposta.status).toBe(201);
    const corpo = resposta.body as { error?: string };
    expect(corpo.error).toBe('Nenhum modelo vinculado para esta sessão');
  });

  it('body acima do limite configurado é RECUSADO com 413', async () => {
    const resposta = await request(app.getHttpServer())
      .post(rota(SESSION_ID_413))
      .set(CABECALHO_SERVICE_TOKEN, tokenDeServicoAtual())
      .send(corpoDeTamanho(3_000_000));

    expect(resposta.status).toBe(413);
  });
});
