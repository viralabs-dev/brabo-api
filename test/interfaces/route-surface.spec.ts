import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Test, TestingModule } from '@nestjs/testing';
import {
  DiscoveryModule,
  DiscoveryService,
  MetadataScanner,
  Reflector,
} from '@nestjs/core';
import { INestApplication, RequestMethod } from '@nestjs/common';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { AppModule } from '../../src/app.module';
import { IS_PUBLIC_KEY } from '../../src/interfaces/http/auth/public.decorator';
import { REQUIRED_ROLE_KEY } from '../../src/interfaces/http/iam/require-role.decorator';

/**
 * Revisão da superfície exposta (Fase 5, item 5).
 *
 * ## O que este teste garante
 *
 * Que `docs/security-surface.md` descreve EXATAMENTE as rotas que a aplicação
 * registra — nem mais, nem menos, com a classificação certa. Uma rota nova sem
 * linha no documento reprova; uma linha que diz `jwt` numa rota que na verdade
 * é `@Public()` reprova; uma linha que sobrou depois de a rota ser removida
 * reprova.
 *
 * ## Por que enumerar em runtime, e não com grep no código
 *
 * Porque o que interessa é o que o Nest REGISTRA. Um `@Get` dentro de um
 * controller que ninguém importou não existe na prática; um controller
 * registrado por um módulo dinâmico não aparece em grep nenhum. Aqui a fonte é
 * o próprio registro da aplicação, via `DiscoveryService` — o mesmo lugar de
 * onde o roteador tira as rotas.
 *
 * O teste sobe o `AppModule` inteiro, então precisa do banco de teste (o mesmo
 * que o `globalSetup` já prepara). É o preço de perguntar à aplicação de
 * verdade em vez de a uma aproximação dela.
 */

type Classificacao = 'public' | 'engine-service' | 'jwt' | `role:${string}`;

interface Rota {
  metodo: string;
  caminho: string;
  classificacao: Classificacao;
}

const DOC = join(__dirname, '../../../../docs/security-surface.md');

/** Lê a tabela do markdown. O documento é a fonte de verdade. */
function rotasDocumentadas(): Map<string, Rota> {
  const conteudo = readFileSync(DOC, 'utf8');
  const linha =
    /^\|\s*(GET|POST|PUT|PATCH|DELETE|ALL|OPTIONS|HEAD)\s*\|\s*`([^`]+)`\s*\|\s*([a-z-]+(?::[a-z-]+)?)\s*\|/gm;

  const mapa = new Map<string, Rota>();
  for (const m of conteudo.matchAll(linha)) {
    const rota: Rota = {
      metodo: m[1],
      caminho: m[2],
      classificacao: m[3] as Classificacao,
    };
    mapa.set(`${rota.metodo} ${rota.caminho}`, rota);
  }
  return mapa;
}

/** Enumera o que a aplicação REGISTRA. */
function rotasRegistradas(app: INestApplication): Map<string, Rota> {
  const discovery = app.get(DiscoveryService);
  const scanner = app.get(MetadataScanner);
  const reflector = app.get(Reflector);
  const mapa = new Map<string, Rota>();

  for (const wrapper of discovery.getControllers()) {
    if (!wrapper.metatype || !wrapper.instance) continue;

    const base = (Reflect.getMetadata(PATH_METADATA, wrapper.metatype) ??
      '') as string;
    const prototipo = Object.getPrototypeOf(wrapper.instance) as object;

    for (const nome of scanner.getAllMethodNames(prototipo)) {
      const handler = (prototipo as Record<string, unknown>)[nome] as (
        ...args: unknown[]
      ) => unknown;

      const sufixo = Reflect.getMetadata(PATH_METADATA, handler) as
        | string
        | undefined;
      if (sufixo === undefined) continue; // não é rota

      const metodo = Reflect.getMetadata(METHOD_METADATA, handler) as number;
      const caminho =
        '/' +
        [base, sufixo]
          .filter((p) => p && p !== '/')
          .join('/')
          .replace(/^\/+/, '');

      const publica = reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
        handler,
        wrapper.metatype,
      ]);
      const papel = reflector.getAllAndOverride<string>(REQUIRED_ROLE_KEY, [
        handler,
        wrapper.metatype,
      ]);
      const guards = [
        ...((Reflect.getMetadata('__guards__', handler) as unknown[]) ?? []),
        ...((Reflect.getMetadata('__guards__', wrapper.metatype) as unknown[]) ??
          []),
      ].map((g) => (g as { name?: string })?.name ?? String(g));

      const classificacao: Classificacao = publica
        ? 'public'
        : guards.includes('EngineServiceGuard')
          ? 'engine-service'
          : papel
            ? (`role:${papel}` as Classificacao)
            : 'jwt';

      mapa.set(`${RequestMethod[metodo]} ${caminho}`, {
        metodo: RequestMethod[metodo],
        caminho,
        classificacao,
      });
    }
  }
  return mapa;
}

describe('superfície exposta da api', () => {
  let modulo: TestingModule;
  let app: INestApplication;
  let registradas: Map<string, Rota>;
  let documentadas: Map<string, Rota>;

  beforeAll(async () => {
    modulo = await Test.createTestingModule({
      imports: [AppModule, DiscoveryModule],
    }).compile();
    app = modulo.createNestApplication();
    await app.init();
    registradas = rotasRegistradas(app);
    documentadas = rotasDocumentadas();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  it('a aplicação registra rotas (guarda contra o teste passar vazio)', () => {
    // Sem isto, um erro de enumeração faria os dois lados serem conjuntos
    // vazios e o teste aprovaria tudo em silêncio — o modo de falha clássico
    // de um teste de tabela.
    expect(registradas.size).toBeGreaterThan(50);
    expect(documentadas.size).toBeGreaterThan(50);
  });

  it('TODA rota registrada está classificada no documento', () => {
    const faltando = [...registradas.keys()]
      .filter((chave) => !documentadas.has(chave))
      .sort();

    expect(
      faltando,
      `Rota(s) sem classificação em docs/security-surface.md. Acrescente uma linha ` +
        `para cada uma decidindo conscientemente a exposição:\n  ${faltando.join('\n  ')}`,
    ).toEqual([]);
  });

  it('o documento não descreve rota que não existe mais', () => {
    const orfas = [...documentadas.keys()]
      .filter((chave) => !registradas.has(chave))
      .sort();

    expect(
      orfas,
      `Linha(s) em docs/security-surface.md sem rota correspondente — remova:\n  ${orfas.join('\n  ')}`,
    ).toEqual([]);
  });

  it('a classificação documentada bate com a anotação real do código', () => {
    const divergentes = [...registradas.entries()]
      .filter(([chave, rota]) => {
        const doc = documentadas.get(chave);
        return doc && doc.classificacao !== rota.classificacao;
      })
      .map(
        ([chave, rota]) =>
          `${chave}: código diz "${rota.classificacao}", documento diz "${documentadas.get(chave)!.classificacao}"`,
      )
      .sort();

    expect(divergentes, divergentes.join('\n  ')).toEqual([]);
  });

  it('as únicas rotas públicas são as quatro justificadas no documento', () => {
    // Trava explícita e separada: as outras asserções pegariam uma pública
    // nova se ela não estivesse documentada, mas não impediriam alguém de
    // documentá-la sem pensar. Aqui, abrir mais uma rota exige mexer NESTE
    // teste — o que força a conversa.
    const publicas = [...registradas.values()]
      .filter((r) => r.classificacao === 'public')
      .map((r) => `${r.metodo} ${r.caminho}`)
      .sort();

    expect(publicas).toEqual([
      'GET /git/oauth/:provider/callback',
      'GET /health',
      'GET /live',
      'GET /metrics',
    ]);
  });
});
