import {
  DocumentBuilder,
  SwaggerModule,
  type OpenAPIObject,
} from '@nestjs/swagger';
import { normalizarDocumento } from './normalizar';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A configuração do documento OpenAPI (Fase 7b, item 6).
 *
 * ## Um lugar só, três consumidores
 *
 * `main.ts` (que serve `/docs`), `scripts/export-openapi.ts` (que materializa
 * `docs/reference/api/openapi.json`) e `test/interfaces/route-surface.spec.ts`
 * (que exige summary e resposta em toda rota) montam o MESMO documento. Se
 * cada um montasse o seu, o site descreveria um contrato que ninguém serve e o
 * teste aprovaria um documento que ninguém gera.
 *
 * ## Nenhuma exigência GLOBAL de segurança, de propósito
 *
 * O caminho óbvio seria `.addSecurityRequirements('bearer')` no builder. Ele
 * quebra nas doze rotas `@Public()`: uma exigência global só se remove com
 * `security: []` na operação, e nenhum decorator do @nestjs/swagger escreve
 * isso. A referência passaria a afirmar que `POST /auth/login` precisa de um
 * token — exatamente o token que ela emite.
 *
 * Em vez disso os schemes são só DECLARADOS aqui, e cada controller diz o que
 * usa: `@ApiBearerAuth()` nos autenticados, `@ApiSecurity(SERVICE_TOKEN)` no
 * `/internal/*`, nada nos públicos. `route-surface.spec.ts` confere que essa
 * anotação bate com o guard de verdade — sem isso, a doc poderia mentir sobre
 * autenticação e nada reprovaria.
 */

/** Nomes dos security schemes. Os controllers referenciam estas constantes. */
export const BEARER = 'bearer';
export const SERVICE_TOKEN = 'service-token';

/**
 * Versão do documento.
 *
 * Sai do package.json e NUNCA de `BRABO_VERSION`: o openapi.json é um arquivo
 * versionado e comparado byte a byte pelo `docs:check`. Uma variável de
 * ambiente ali faria o arquivo mudar conforme a máquina que rodou o gerador, e
 * o check viraria ruído que todo mundo aprende a ignorar.
 */
function versao(): string {
  const pkg = JSON.parse(
    readFileSync(join(__dirname, '../../../package.json'), 'utf8'),
  ) as { version?: string };
  return pkg.version ?? '0.0.0';
}

/**
 * A visão geral da referência (Fase 7b, item 5).
 *
 * Mora aqui e não num Markdown à mão porque é `info.description` que o
 * docusaurus-plugin-openapi-docs transforma na página de índice de
 * `docs/reference/api/`. Escrita nos dois lugares, divergiria no primeiro mês.
 */
const VISAO_GERAL = `
A API do Brabo. Todo endpoint devolve JSON, salvo os quatro documentados
explicitamente com outro \`content-type\` (dois de SSE, o de métricas e o
callback de OAuth, que redireciona).

## Autenticação

O access token é um JWT **EdDSA de 15 minutos**, apresentado em
\`Authorization: Bearer <token>\`. A chave pública fica em
\`GET /.well-known/jwks.json\`.

O refresh **não** é um JWT: é um token opaco que vive num cookie \`httpOnly\`
(\`brabo_refresh\`, \`Path=/auth\`, \`SameSite=Strict\`) e nunca aparece no corpo
de nenhuma resposta. \`POST /auth/refresh\` e \`POST /auth/logout\` leem o cookie
e exigem o cabeçalho \`X-CSRF-Token\` igual ao cookie \`brabo_csrf\`.

**A rotação é obrigatória.** Cada refresh consome o token apresentado e emite
outro. Reapresentar um já consumido é assinatura de roubo e revoga a família
inteira — inclusive a sessão legítima. Um cliente que dispare dois refresh
concorrentes derruba o próprio usuário; use uma única chamada em voo.

As rotas \`/internal/*\` são a superfície api ↔ engine e ficam **fora do JWT**:
elas exigem o cabeçalho \`X-Brabo-Service-Token\` com o segredo compartilhado.
Um token de usuário não abre nenhuma delas.

## Erros

Formato padrão do NestJS: \`{ "statusCode": number, "message": string | string[], "error": string }\`.

| código | quando |
|---|---|
| \`400\` | corpo inválido — o \`ValidationPipe\` roda com \`whitelist\` e \`forbidNonWhitelisted\`, então campo desconhecido também reprova |
| \`401\` | sem token, token expirado ou credencial inválida |
| \`403\` | autenticado mas sem o papel exigido pelo RBAC, ou service token errado |
| \`404\` | recurso inexistente **ou** invisível para quem chamou |
| \`409\` | conflito de estado — transição de sessão inválida, recurso já existente |
| \`429\` | rate limit ou lockout progressivo |

As rotas de auth respondem de forma **deliberadamente indistinguível** entre
e-mail inexistente, senha errada e conta bloqueada: mesmo corpo, mesmo status,
mesmo tempo. É o que fecha a enumeração de contas, e não é defeito de
diagnóstico.

## Rate limit

Janela deslizante no Postgres: 300 requisições por usuário e 600 por IP a cada
60 s, configuráveis. Rota \`@Public()\` e rota de serviço são **isentas** — o que
segura \`/auth/*\` é o lockout progressivo, não o rate limit.
`.trim();

/** O builder. `SwaggerModule.createDocument(app, configDoOpenapi())`. */
export function configDoOpenapi(): Omit<OpenAPIObject, 'paths'> {
  return new DocumentBuilder()
    .setTitle('Brabo API')
    .setDescription(VISAO_GERAL)
    .setVersion(versao())
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      BEARER,
    )
    .addApiKey(
      { type: 'apiKey', name: 'X-Brabo-Service-Token', in: 'header' },
      SERVICE_TOKEN,
    )
    .build();
}

/**
 * As respostas de erro que vêm da CADEIA DE GUARDS, não do handler.
 *
 * `401`, `429` e `400` não são propriedade de nenhuma rota em particular:
 * saem do `JwtAuthGuard`, do `RateLimitGuard` e do `ValidationPipe` globais.
 * Declará-las por decorator seria repetir os mesmos três blocos em mais de cem
 * lugares — e a primeira que alguém esquecesse viraria uma mentira por
 * omissão.
 *
 * Por isso a injeção é derivada do que o próprio documento já diz:
 *
 * - operação com `security: bearer` passa pelo `JwtAuthGuard` (→ 401) e pelo
 *   `RateLimitGuard`, que ISENTA `@Public()` e `@ServiceRoute()` (→ 429);
 * - operação com `requestBody` passa pelo `ValidationPipe`, que roda com
 *   `whitelist` e `forbidNonWhitelisted` (→ 400, inclusive por campo
 *   desconhecido).
 *
 * Uma declaração específica da rota SEMPRE vence: se o handler já descreveu o
 * 400 dele, o genérico não sobrescreve.
 */
function injetarErrosDeGuard(documento: OpenAPIObject): OpenAPIObject {
  const GENERICAS: Record<string, string> = {
    '400':
      'Corpo inválido. O `ValidationPipe` roda com `whitelist` e ' +
      '`forbidNonWhitelisted`, então campo desconhecido também reprova.',
    '401': 'Sem token, token expirado ou assinatura inválida.',
    '429': 'Rate limit por usuário ou por IP.',
  };

  for (const operacoes of Object.values(documento.paths ?? {})) {
    for (const operacao of Object.values(
      operacoes as Record<string, unknown>,
    )) {
      const op = operacao as {
        responses?: Record<string, { description?: string }>;
        security?: Record<string, string[]>[];
        requestBody?: unknown;
      };
      if (!op || typeof op !== 'object' || !op.responses) continue;

      const autenticada = (op.security ?? []).some((s) => BEARER in s);
      const codigos = [
        ...(op.requestBody ? ['400'] : []),
        ...(autenticada ? ['401', '429'] : []),
      ];

      for (const codigo of codigos) {
        op.responses[codigo] ??= { description: GENERICAS[codigo] };
      }
    }
  }
  return documento;
}

/**
 * O documento completo: escaneado, com os erros de guard e normalizado.
 *
 * `main.ts` (que serve `/docs`), o script de export e `route-surface.spec.ts`
 * usam ESTA função. Chamar `SwaggerModule.createDocument` direto pularia a
 * injeção, e cada consumidor veria um documento diferente.
 */
export function montarDocumento(
  app: Parameters<typeof SwaggerModule.createDocument>[0],
) {
  return normalizarDocumento(
    injetarErrosDeGuard(SwaggerModule.createDocument(app, configDoOpenapi())),
  );
}
