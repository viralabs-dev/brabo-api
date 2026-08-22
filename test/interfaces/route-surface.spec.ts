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
import {
  PATH_METADATA,
  METHOD_METADATA,
  HTTP_CODE_METADATA,
} from '@nestjs/common/constants';
import type { OpenAPIObject } from '@nestjs/swagger';
import { AppModule } from '../../src/app.module';
import { IS_PUBLIC_KEY } from '../../src/interfaces/http/auth/public.decorator';
import { REQUIRED_ROLE_KEY } from '../../src/interfaces/http/iam/require-role.decorator';
import {
  BEARER,
  SERVICE_TOKEN,
  montarDocumento,
} from '../../src/infrastructure/openapi/documento';

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
 *
 * ## O que a Fase 7b acrescentou
 *
 * A classificação de exposição sozinha diz quem PODE chamar, e nada sobre o
 * que a rota faz. As asserções novas exigem os metadados de OpenAPI — summary,
 * resposta com corpo descrito, tag de uma lista fechada — e conferem que o
 * documento gerado NÃO MENTE sobre autenticação. É o mecanismo anti-drift que
 * o docmap não tem: o docmap dispara quando um arquivo muda, mas não enxerga
 * rota nova que nasceu sem documentação.
 *
 * As asserções são feitas sobre o DOCUMENTO montado por
 * `SwaggerModule.createDocument`, e não sobre os metadados refletidos um a um.
 * O documento é o artefato que vai para o site: um `type:` apontando para uma
 * interface (que o @nestjs/swagger resolve como `{}` sem avisar) passaria numa
 * checagem de decorator e reprova aqui.
 */

type Classificacao = 'public' | 'engine-service' | 'jwt' | `role:${string}`;

interface Rota {
  metodo: string;
  caminho: string;
  classificacao: Classificacao;
  /**
   * O status que a rota DEVOLVE de verdade — `@HttpCode` quando existe, senão
   * o default do Nest (201 no POST, 200 no resto).
   *
   * Existe porque o @nestjs/swagger IGNORA o `@HttpCode` quando há qualquer
   * `@ApiResponse` na rota: o status documentado passa a vir só do decorator.
   * Sem esta conferência, um `@ApiOkResponse` num handler `@HttpCode(202)`
   * documenta 200 e ninguém percebe — foi exatamente o que aconteceu em duas
   * rotas de auth.
   *
   * Só é preenchido para as rotas registradas; a tabela do markdown não o tem.
   */
  statusReal?: number;
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
        string | undefined;
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
        ...((Reflect.getMetadata(
          '__guards__',
          wrapper.metatype,
        ) as unknown[]) ?? []),
      ].map((g) => (g as { name?: string })?.name ?? String(g));

      const classificacao: Classificacao = publica
        ? 'public'
        : guards.includes('EngineServiceGuard')
          ? 'engine-service'
          : papel
            ? (`role:${papel}` as Classificacao)
            : 'jwt';

      const httpCode = Reflect.getMetadata(HTTP_CODE_METADATA, handler) as
        number | undefined;

      mapa.set(`${RequestMethod[metodo]} ${caminho}`, {
        metodo: RequestMethod[metodo],
        caminho,
        classificacao,
        statusReal: httpCode ?? (metodo === RequestMethod.POST ? 201 : 200),
      });
    }
  }
  return mapa;
}

/**
 * Rotas que legitimamente NÃO têm corpo JSON, e o que se exige de cada uma.
 *
 * Não é escape hatch: cada categoria tem obrigação PRÓPRIA, verificada abaixo.
 * "É um stream" ou "não devolve nada" deixariam de fora exatamente o que quem
 * consome precisa saber. Entrada aqui que não corresponde a rota nenhuma, ou
 * rota daqui que passou a ter corpo JSON, também reprovam — senão a lista
 * apodrece.
 */
const SEM_CORPO_JSON = new Map<
  string,
  'sse' | 'texto' | 'redirect' | 'sem-conteudo'
>([
  ['POST /projects/:projectId/sessions/:sessionId/chat', 'sse'],
  ['POST /internal/sessions/:sessionId/llm-turn-stream', 'sse'],
  ['GET /metrics', 'texto'],
  ['GET /git/oauth/:provider/callback', 'redirect'],
  ['GET /auth/oauth/:provider/start', 'redirect'],
  ['GET /auth/oauth/:provider/callback', 'redirect'],
  ['POST /auth/logout', 'sem-conteudo'],
  ['POST /auth/verify-email', 'sem-conteudo'],
  ['POST /auth/reset-password', 'sem-conteudo'],
  ['PUT /projects/:projectId/agent-autonomy', 'sem-conteudo'],
  ['DELETE /projects/:projectId/members/:userId', 'sem-conteudo'],
  // FASE 23 / ADR 0064 — "voltar a herdar" é 204: apaga o binding, sem corpo.
  ['DELETE /projects/:projectId/agent-bindings/:agentSlug', 'sem-conteudo'],
  ['DELETE /projects/:projectId/area-bindings/:areaKey', 'sem-conteudo'],
  // ADR 0105 — revogar PAT é 204, sem corpo.
  [
    'DELETE /projects/:projectId/personal-access-tokens/:tokenId',
    'sem-conteudo',
  ],
]);

/**
 * Rotas deliberadamente FORA da referência.
 *
 * Excluir precisa ser tão explícito quanto documentar: sem esta lista,
 * `@ApiExcludeEndpoint()` seria a saída fácil para escapar de toda a exigência
 * de metadados, e ninguém notaria.
 */
const EXCLUIDAS_DA_REFERENCIA = ['GET /'];

/** As tags permitidas. Acrescentar uma exige mexer AQUI — força a conversa. */
const TAGS_PERMITIDAS = [
  'auth',
  'workspaces',
  'projetos',
  'sessões',
  'agentes',
  'ações',
  'backlog',
  'execução',
  'anamnese',
  'psicólogo',
  'llm',
  'credenciais',
  'git',
  // PROGRAMA 28, Onda 4 (G2) — indexação e busca híbrida do Chat RAG.
  'rag',
  'infraestrutura',
  'internal',
  // FASE 15b: o registro de gates, para a tela derivar as etapas em vez de
  // repetir a lista no código.
  'gates',
  // Fundação de i18n (Onda 6a) — preferência de idioma do próprio usuário.
  // Não é 'credenciais': não guarda segredo nenhum.
  'usuários',
];

/** `/projects/{id}` (OpenAPI) → `/projects/:id` (Nest), para as chaves baterem. */
function comoNest(caminho: string): string {
  return caminho.replace(/\{(\w+)\}/g, ':$1');
}

interface Operacao {
  summary?: string;
  tags?: string[];
  security?: Record<string, string[]>[];
  responses?: Record<
    string,
    {
      description?: string;
      content?: Record<string, { schema?: unknown }>;
      headers?: Record<string, unknown>;
    }
  >;
}

/** As operações do documento, com a MESMA chave de `rotasRegistradas`. */
function operacoesDoDocumento(documento: OpenAPIObject): Map<string, Operacao> {
  const mapa = new Map<string, Operacao>();
  for (const [caminho, ops] of Object.entries(documento.paths ?? {})) {
    for (const [verbo, op] of Object.entries(ops as Record<string, unknown>)) {
      if (!['get', 'post', 'put', 'patch', 'delete'].includes(verbo)) continue;
      mapa.set(`${verbo.toUpperCase()} ${comoNest(caminho)}`, op as Operacao);
    }
  }
  return mapa;
}

/** Chaves de sucesso (2xx/3xx) daquela operação. */
function sucessos(op: Operacao): string[] {
  return Object.keys(op.responses ?? {}).filter(
    (c) => c[0] === '2' || c[0] === '3',
  );
}

describe('superfície exposta da api', () => {
  let modulo: TestingModule;
  let app: INestApplication;
  let registradas: Map<string, Rota>;
  let documentadas: Map<string, Rota>;
  let operacoes: Map<string, Operacao>;

  beforeAll(async () => {
    modulo = await Test.createTestingModule({
      imports: [AppModule, DiscoveryModule],
    }).compile();
    app = modulo.createNestApplication();
    await app.init();
    registradas = rotasRegistradas(app);
    documentadas = rotasDocumentadas();
    operacoes = operacoesDoDocumento(montarDocumento(app));
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

  it('as únicas rotas públicas são as justificadas no documento', () => {
    // Trava explícita e separada: as outras asserções pegariam uma pública
    // nova se ela não estivesse documentada, mas não impediriam alguém de
    // documentá-la sem pensar. Aqui, abrir mais uma rota exige mexer NESTE
    // teste — o que força a conversa.
    //
    // A lista saltou de quatro para doze na Fase 7a, e a conversa aconteceu:
    // as oito novas são o auth first-party. Todas precisam ser públicas porque
    // o guard global ainda verifica token do Keycloak — exigir token numa rota
    // de auth pediria credencial do sistema antigo para entrar no novo. O que
    // as protege é o lockout progressivo, não o RateLimitGuard, que libera
    // rota `@Public()`. Ver docs/security-surface.md.
    const publicas = [...registradas.values()]
      .filter((r) => r.classificacao === 'public')
      .map((r) => `${r.metodo} ${r.caminho}`)
      .sort();

    expect(publicas).toEqual([
      'GET /.well-known/jwks.json',
      'GET /auth/oauth/:provider/callback',
      'GET /auth/oauth/:provider/start',
      'GET /git/oauth/:provider/callback',
      'GET /health',
      'GET /live',
      'GET /metrics',
      'POST /auth/login',
      'POST /auth/logout',
      'POST /auth/refresh',
      'POST /auth/register',
      'POST /auth/request-password-reset',
      'POST /auth/reset-password',
      'POST /auth/verify-email',
    ]);
  });

  // ------------------------------------------------- metadados de OpenAPI (7b)

  it('o documento OpenAPI cobre exatamente as rotas registradas', () => {
    // Primeiro de todos de propósito: é ele que impede `@ApiExcludeEndpoint()`
    // de virar a saída fácil para escapar das asserções seguintes. Excluir uma
    // rota passa a exigir mexer em EXCLUIDAS_DA_REFERENCIA, aqui neste arquivo.
    const esperadas = [...registradas.keys()]
      .filter((c) => !EXCLUIDAS_DA_REFERENCIA.includes(c))
      .sort();
    const noDocumento = [...operacoes.keys()].sort();

    const ausentes = esperadas.filter((c) => !operacoes.has(c));
    const sobrando = noDocumento.filter((c) => !registradas.has(c));

    expect(
      ausentes,
      'Rota(s) registrada(s) que NÃO aparecem no documento OpenAPI. Se a ausência ' +
        'for intencional, declare em EXCLUIDAS_DA_REFERENCIA com o motivo:\n  ' +
        ausentes.join('\n  '),
    ).toEqual([]);
    expect(
      sobrando,
      `Operação no documento sem rota correspondente:\n  ${sobrando.join('\n  ')}`,
    ).toEqual([]);
  });

  it('toda rota documentada tem summary', () => {
    const sem = [...operacoes.entries()]
      .filter(([, op]) => !op.summary?.trim())
      .map(([chave]) => chave)
      .sort();

    expect(
      sem,
      'Rota(s) sem `@ApiOperation({ summary })`. Uma frase dizendo o que a rota ' +
        `FAZ — a classificação de exposição já diz quem pode chamar:\n  ${sem.join('\n  ')}`,
    ).toEqual([]);
  });

  it('toda rota documenta uma resposta de sucesso que diz alguma coisa', () => {
    // A asserção ingênua ("tem chave 2xx") passaria em TODAS as rotas mesmo sem
    // um decorator sequer: o @nestjs/swagger sintetiza `{'200': {description:
    // ''}}` quando não há nenhum. Antes desta fase, 111 das 118 rotas estavam
    // exatamente nesse estado. Por isso o critério é conteúdo resolvido OU
    // descrição não vazia.
    const problemas: string[] = [];

    for (const [chave, op] of operacoes) {
      const codigos = sucessos(op);
      if (codigos.length === 0) {
        problemas.push(`${chave}: nenhuma resposta 2xx/3xx documentada`);
        continue;
      }

      const resposta = op.responses![codigos[0]];
      const temConteudo = Object.keys(resposta.content ?? {}).length > 0;
      const temDescricao = Boolean(resposta.description?.trim());
      const temHeaders = Object.keys(resposta.headers ?? {}).length > 0;

      if (!temConteudo && !temDescricao && !temHeaders) {
        problemas.push(
          `${chave}: resposta ${codigos[0]} sintetizada e vazia — falta @ApiOkResponse/@ApiCreatedResponse com \`type\``,
        );
        continue;
      }

      const categoria = SEM_CORPO_JSON.get(chave);
      if (!categoria && !resposta.content?.['application/json']) {
        problemas.push(
          `${chave}: sem corpo \`application/json\`. Se for intencional, declare em SEM_CORPO_JSON`,
        );
      }
    }

    expect(problemas, problemas.join('\n  ')).toEqual([]);
  });

  it('as rotas sem corpo JSON provam o que devolvem no lugar', () => {
    // Estar na lista não isenta de documentar: isenta de documentar JSON.
    const problemas: string[] = [];

    for (const [chave, categoria] of SEM_CORPO_JSON) {
      const op = operacoes.get(chave);
      if (!op) {
        problemas.push(
          `${chave}: em SEM_CORPO_JSON mas não existe — remova a entrada`,
        );
        continue;
      }
      const codigos = sucessos(op);
      const resposta =
        codigos.length > 0 ? op.responses![codigos[0]] : undefined;

      if (resposta?.content?.['application/json']) {
        problemas.push(
          `${chave}: passou a ter corpo JSON — tire de SEM_CORPO_JSON e documente com \`type\``,
        );
        continue;
      }

      switch (categoria) {
        case 'sse':
          if (!resposta?.content?.['text/event-stream']) {
            problemas.push(
              `${chave}: SSE sem \`text/event-stream\` declarado. O formato de cada QUADRO é o que o cliente precisa`,
            );
          }
          break;
        case 'texto':
          if (!resposta?.content?.['text/plain']) {
            problemas.push(`${chave}: sem \`text/plain\` declarado`);
          }
          break;
        case 'redirect':
          if (!codigos.includes('302')) {
            problemas.push(`${chave}: redirect sem resposta 302 documentada`);
          } else if (!op.responses!['302'].headers?.Location) {
            problemas.push(
              `${chave}: 302 sem o header \`Location\` — é ele que diz para onde a chamada vai parar`,
            );
          }
          break;
        case 'sem-conteudo':
          if (!codigos.includes('204')) {
            problemas.push(
              `${chave}: declarado sem conteúdo mas não documenta 204`,
            );
          }
          break;
      }
    }

    expect(problemas, problemas.join('\n  ')).toEqual([]);
  });

  it('o status documentado é o status que a rota devolve de verdade', () => {
    // O @nestjs/swagger IGNORA `@HttpCode` assim que existe qualquer
    // `@ApiResponse` na rota (api-response.explorer.js): o status passa a vir
    // só do decorator. Um `@ApiOkResponse` num handler `@HttpCode(202)`
    // documenta 200 e nada reclama — aconteceu em duas rotas de auth.
    //
    // SSE e redirect ficam de fora porque nelas o Nest NÃO decide o status: o
    // `@Sse` sempre escreve 200 e o handler com `@Res()` escreve o que quiser
    // direto na resposta. Comparar com o default do verbo acusaria divergência
    // onde a documentação é que está certa. As duas categorias têm obrigação
    // própria na asserção de SEM_CORPO_JSON, então não escapam de nada.
    const statusForaDoNest = new Set(
      [...SEM_CORPO_JSON.entries()]
        .filter(
          ([, categoria]) => categoria === 'sse' || categoria === 'redirect',
        )
        .map(([chave]) => chave),
    );

    const divergentes = [...operacoes.entries()]
      .filter(([chave, op]) => {
        if (statusForaDoNest.has(chave)) return false;
        const real = registradas.get(chave)?.statusReal;
        return real !== undefined && !sucessos(op).includes(String(real));
      })
      .map(([chave, op]) => {
        const real = registradas.get(chave)!.statusReal;
        return `${chave}: devolve ${real}, documenta ${sucessos(op).join('/') || '(nada)'}`;
      })
      .sort();

    expect(divergentes, divergentes.join('\n  ')).toEqual([]);
  });

  it('toda rota tem tag, e da lista fechada', () => {
    const semTag: string[] = [];
    const desconhecidas: string[] = [];

    for (const [chave, op] of operacoes) {
      const tags = op.tags ?? [];
      if (tags.length === 0) {
        semTag.push(chave);
        continue;
      }
      for (const tag of tags) {
        if (!TAGS_PERMITIDAS.includes(tag)) {
          desconhecidas.push(`${chave}: tag "${tag}"`);
        }
      }
    }

    expect(
      semTag,
      'Rota(s) sem `@ApiTags`. Sem tag a rota some numa seção "default" do site ' +
        `gerado:\n  ${semTag.join('\n  ')}`,
    ).toEqual([]);
    expect(
      desconhecidas.sort(),
      'Tag fora da lista fechada. Se a seção nova é mesmo necessária, acrescente ' +
        `a tag em TAGS_PERMITIDAS neste teste:\n  ${desconhecidas.join('\n  ')}`,
    ).toEqual([]);
  });

  it('o documento não mente sobre autenticação', () => {
    // A que dá valor a tudo o mais: amarra o OpenAPI aos GUARDS de verdade. Sem
    // ela a referência poderia afirmar que uma rota é pública quando o guard a
    // fecha, ou o contrário — e a doc erraria justamente onde errar é caro.
    const problemas: string[] = [];

    for (const [chave, op] of operacoes) {
      const rota = registradas.get(chave);
      if (!rota) continue;
      const schemes = (op.security ?? []).flatMap((s) => Object.keys(s));

      if (rota.classificacao === 'public') {
        if (schemes.length > 0) {
          problemas.push(
            `${chave}: é @Public() mas o documento exige ${schemes.join(', ')}`,
          );
        }
      } else if (rota.classificacao === 'engine-service') {
        if (!schemes.includes(SERVICE_TOKEN)) {
          problemas.push(
            `${chave}: exige service token no código, mas o documento não declara @ApiSecurity`,
          );
        }
      } else if (!schemes.includes(BEARER)) {
        problemas.push(
          `${chave}: é autenticada (${rota.classificacao}) mas o documento não declara @ApiBearerAuth`,
        );
      }
    }

    expect(problemas, problemas.join('\n  ')).toEqual([]);
  });
});
