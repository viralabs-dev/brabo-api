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
The Brabo API. Every endpoint returns JSON, except the four explicitly
documented with a different \`content-type\` (two SSE ones, the metrics one,
and the OAuth callback, which redirects).

## Authentication

The access token is a **15-minute EdDSA JWT**, presented in
\`Authorization: Bearer <token>\`. The public key lives at
\`GET /.well-known/jwks.json\`.

The refresh **is not** a JWT: it's an opaque token that lives in an
\`httpOnly\` cookie (\`brabo_refresh\`, \`Path=/auth\`, \`SameSite=Strict\`) and
never appears in any response body. \`POST /auth/refresh\` and
\`POST /auth/logout\` read the cookie and require the \`X-CSRF-Token\` header
to match the \`brabo_csrf\` cookie.

**Rotation is mandatory.** Each refresh consumes the presented token and
issues another. Re-presenting an already-consumed one is a theft signature
and revokes the WHOLE family — including the legitimate session. A client
that fires two concurrent refreshes takes itself down; use a single in-flight
call.

The \`/internal/*\` routes are the api ↔ engine surface and sit **outside the
JWT**: they require the \`X-Brabo-Service-Token\` header with the shared
secret. A user token doesn't open any of them.

## Errors

NestJS default format: \`{ "statusCode": number, "message": string | string[], "error": string }\`.

| code | when |
|---|---|
| \`400\` | invalid body — the \`ValidationPipe\` runs with \`whitelist\` and \`forbidNonWhitelisted\`, so an unknown field also fails |
| \`401\` | no token, expired token, or invalid credential |
| \`403\` | authenticated but without the role RBAC requires, or a wrong service token |
| \`404\` | resource doesn't exist **or** is invisible to the caller |
| \`409\` | state conflict — invalid session transition, resource already exists |
| \`429\` | rate limit or progressive lockout |

Auth routes respond **deliberately indistinguishably** between a nonexistent
email, a wrong password, and a locked account: same body, same status, same
timing. That's what closes account enumeration, and it's not a diagnostic
defect.

## Rate limit

Sliding window in Postgres: 300 requests per user and 600 per IP every 60s,
configurable. A \`@Public()\` route and a service route are **exempt** — what
guards \`/auth/*\` is the progressive lockout, not the rate limit.
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
      'Invalid body. The `ValidationPipe` runs with `whitelist` and ' +
      '`forbidNonWhitelisted`, so an unknown field also fails.',
    '401': 'No token, expired token, or invalid signature.',
    '429': 'Rate limit per user or per IP.',
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
