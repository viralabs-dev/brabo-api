// Auth first-party (Fase 7a) — `domain/auth`, a maior pasta de domínio do
// projeto, e por isso também o maior arquivo desta divisão.
//
// `rate_limit_hits` e `auth_lockout_hits` são tabelas de CONTENÇÃO, não de
// identidade: ficam aqui porque quem as lê é o caminho de login.

import {
  pgTable,
  pgEnum,
  uuid,
  text,
  bigserial,
  jsonb,
  timestamp,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { projects, users } from './iam';

/**
 * Janela deslizante do rate limit (Fase 5, item 7).
 *
 * Uma linha por request contado. O CLAUDE.md proíbe Redis (as filas ficam no
 * Postgres via Oban), então a janela vive aqui — o custo é um INSERT por
 * request, assumido e documentado no ADR 0027, com `RATE_LIMIT_ENABLED` para
 * desligar.
 *
 * Sem chave estrangeira para `users` de propósito: o balde de IP não tem
 * usuário, e a FK obrigaria a apagar histórico de rate limit ao remover um
 * usuário — exatamente o registro que se quer preservar num incidente de abuso.
 */
export const rateLimitHits = pgTable(
  'rate_limit_hits',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    // `user:<uuid>` ou `ip:<endereço>`.
    bucketKey: text('bucket_key').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Composto e nesta ordem: a consulta é sempre "quantos hits deste balde
    // depois de T". Índice só em bucket_key faria o Postgres varrer todo o
    // histórico do balde para filtrar por tempo depois.
    index('rate_limit_hits_bucket_idx').on(table.bucketKey, table.occurredAt),
    // A poda apaga por tempo, sem balde — precisa do índice próprio.
    index('rate_limit_hits_occurred_idx').on(table.occurredAt),
  ],
);

// Motivo da revogação de um refresh token. Enum e não texto livre porque o
// conjunto é fechado e cada valor dispara leitura diferente numa investigação:
// `reuse_detected` é sinal de roubo, `logout` é o usuário, `password_reset` é
// resposta a suspeita de comprometimento.
export const refreshRevokeReasonEnum = pgEnum('refresh_revoke_reason', [
  'reuse_detected',
  'logout',
  'password_reset',
  'family_max_age',
]);

// Propósito de um token de conta. Uma tabela com enum, não três tabelas: a
// mecânica é idêntica (segredo aleatório, hash em repouso, TTL, consumo único,
// supersede dos irmãos) e o que muda é DADO — TTL e efeito. Três tabelas
// significariam três cópias do UPDATE atômico de consumo, que é a única coisa
// aqui que não dá para errar duas vezes.
export const accountTokenPurposeEnum = pgEnum('account_token_purpose', [
  'email_verification',
  'password_reset',
  // Usuário importado do Keycloak: senha não migra (Fase 7, item 4), então a
  // primeira senha nasce por este fluxo. O valor entra agora porque adicioná-lo
  // depois custaria migração de enum numa fase em que ele já seria necessário.
  'set_initial_password',
]);

/**
 * Senha do usuário — Fase 7a, item 1.
 *
 * Nome propositalmente diferente de `user_credentials`, que guarda chaves de
 * LLM e tokens de git com envelope encryption. São coisas opostas: aquilo é
 * segredo RECUPERÁVEL (o sistema precisa do valor em claro para chamar a API
 * do provider), isto é verificador de senha, que nunca volta a texto. Chamar
 * as duas de "credentials" convidaria a reusar o envelope aqui, que seria erro
 * de segurança, não de nomenclatura.
 */
export const authCredentials = pgTable('auth_credentials', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: 'cascade' }),
  // A string codificada do argon2id, que já embute algoritmo, versão, m, t, p
  // e o salt. Guardar os parâmetros em coluna separada duplicaria o que o
  // próprio formato carrega, com risco de divergirem no re-hash.
  passwordHash: text('password_hash').notNull(),
  // Quando a senha mudou pela última vez. É o que um re-hash oportunista e uma
  // política de expiração futura vão consultar.
  passwordUpdatedAt: timestamp('password_updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
  disabledAt: timestamp('disabled_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Providers de login social (RN-272..286, ADR 0084). Enum PRÓPRIO — não é o
// mesmo conjunto de `gitProviderEnum`, que inclui `local` e representa onde o
// CÓDIGO mora, não quem AUTENTICA. Hoje os dois catálogos coincidem em
// github/gitlab por acaso: são os únicos dois com `GitOauthClient` registrado.
export const socialIdentityProviderEnum = pgEnum('social_identity_provider', [
  'github',
  'gitlab',
]);

/**
 * Vínculo de identidade social (login via OAuth, ADR 0084).
 *
 * Tabela NOVA, e não coluna em `users` — `keycloak_sub` já ensinou o erro de
 * dedicar uma coluna a UM provider: um usuário pode ter GitHub e GitLab ao
 * mesmo tempo (uma linha por provider), e o dia de somar um terceiro provider
 * OAuth não pede migração de schema, só um valor novo no enum.
 *
 * `providerUserId` é o id NUMÉRICO estável do provider — NUNCA o login/e-mail,
 * que podem mudar. `(provider, providerUserId)` é a chave que decide se um
 * retorno de OAuth é um login conhecido.
 *
 * `userId` é NOT NULL: o vínculo nasce no MESMO passo que resolve a
 * identidade (login de conta existente, vínculo por e-mail verificado, ou
 * provisionamento de conta nova) — não existe hoje um fluxo de duas etapas
 * que crie o vínculo antes de saber a quem ele pertence.
 */
export const socialIdentities = pgTable(
  'social_identities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: socialIdentityProviderEnum('provider').notNull(),
    providerUserId: text('provider_user_id').notNull(),
    providerEmail: text('provider_email'),
    providerLogin: text('provider_login'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('social_identities_provider_account_idx').on(
      table.provider,
      table.providerUserId,
    ),
    index('social_identities_user_id_idx').on(table.userId),
  ],
);

/**
 * Refresh tokens opacos com rotação obrigatória — Fase 7a, item 1.
 *
 * ## Por que HMAC-SHA256 e não argon2
 *
 * O token tem 256 bits de CSPRNG: não existe dicionário contra isso, então o
 * custo do argon2 compraria zero bit. E argon2 tem salt por registro, o que
 * tornaria o hash função de (token, salt) em vez de só do token — e
 * `where token_hash = $1` ficaria impossível. Ver auth-key-material.ts.
 *
 * ## A família
 *
 * Um login nasce uma família. Cada refresh consome o token atual (`rotated_at`)
 * e emite um filho com o MESMO `family_id`. Apresentar um token já rotacionado
 * é a assinatura do roubo: alguém está usando uma cópia. A resposta é matar a
 * família inteira.
 */
export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    familyId: uuid('family_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    // Herdado do pai, sem alteração, por toda a cadeia. É o teto ABSOLUTO da
    // sessão: sem ele, rotação a cada 15 min dá sessão eterna, e ninguém
    // percebe até alguém perguntar quanto tempo uma sessão pode viver.
    familyStartedAt: timestamp('family_started_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Consumo NORMAL. Ortogonal a revoked_at de propósito: "você apresentou um
    // token que já foi gasto" (sinal de roubo, cascata) é diferente de "você
    // apresentou um token que a cascata de outro matou" (vítima a jusante,
    // sem novo alarme). Colapsar os dois faria cada revogação de família gerar
    // N alarmes falsos conforme as outras abas do usuário voltassem.
    rotatedAt: timestamp('rotated_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedReason: refreshRevokeReasonEnum('revoked_reason'),
    issuedIp: text('issued_ip'),
    issuedUserAgent: text('issued_user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('refresh_tokens_hash_idx').on(table.tokenHash),
    index('refresh_tokens_family_idx').on(table.familyId),
    index('refresh_tokens_user_idx').on(table.userId),
    // A poda apaga por tempo — índice próprio, igual ao de rate_limit_hits.
    index('refresh_tokens_expires_idx').on(table.expiresAt),
  ],
);

/**
 * Tokens de uso único de verificação de e-mail e reset de senha — Fase 7a,
 * item 3.
 *
 * Estes viajam em URL, então acabam em log de provedor de e-mail, histórico do
 * browser e cabeçalho `Referer`. O pepper protege contra dump do banco;
 * nenhuma coluna protege uma URL vazada. Daí o TTL do reset ser curto.
 */
export const accountTokens = pgTable(
  'account_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    purpose: accountTokenPurposeEnum('purpose').notNull(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    // Distinto de consumed_at: 'superseded' (pediu outro link) e
    // 'password_changed' (a senha mudou por outro caminho) invalidam sem que
    // ninguém tenha usado o token.
    invalidatedAt: timestamp('invalidated_at', { withTimezone: true }),
    invalidatedReason: text('invalidated_reason'),
    requestedIp: text('requested_ip'),
    consumedIp: text('consumed_ip'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('account_tokens_hash_idx').on(table.tokenHash),
    // Parcial: o supersede na emissão só olha os vivos, que são um ou dois.
    index('account_tokens_live_idx')
      .on(table.userId, table.purpose)
      .where(
        sql`${table.consumedAt} is null and ${table.invalidatedAt} is null`,
      ),
    index('account_tokens_expires_idx').on(table.expiresAt),
  ],
);

/**
 * Personal Access Token do runner local (`brb_…`, ADR 0105) — escopado a
 * UM projeto, e só à capacidade de pedir ticket de runner
 * (`POST /projects/:projectId/runner-ticket`, `PatAuthGuard`). Diferente de
 * `accountTokens`, permite VÁRIOS tokens vivos por usuário+projeto ao mesmo
 * tempo (um por máquina) — não há supersede-on-issue. Diferente de
 * `refreshTokens`, é apresentado repetidamente SEM MUDAR: não é
 * consumido-e-reemitido por uso, então não tem `familyId`/rotação.
 *
 * Hash HMAC-SHA256+pepper via `hashDeToken()` (`TokenFactory.hashDe`), o
 * mesmo mecanismo de `refreshTokens`/`accountTokens` — nunca argon2: um
 * token de 256 bits de CSPRNG não tem superfície de dicionário, e o salt
 * por linha do argon2 só quebraria a busca indexada por `token_hash`.
 */
export const personalAccessTokens = pgTable(
  'personal_access_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedReason: text('revoked_reason'),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('personal_access_tokens_hash_idx').on(table.tokenHash),
    index('personal_access_tokens_user_idx').on(table.userId),
    index('personal_access_tokens_project_idx').on(table.projectId),
  ],
);

/**
 * Chave de dispositivo do runner local (Ed25519, gerada NO NAVEGADOR) — a
 * segunda forma de autenticar `POST /projects/:projectId/runner-ticket`,
 * ao lado do Personal Access Token acima (`PatAuthGuard`). Só a metade
 * PÚBLICA mora aqui: a privada nunca sai do navegador/máquina do usuário, e
 * o dispositivo prova posse assinando um JWT curto (EdDSA) que o guard
 * verifica contra `publicKeyJwk`. Diferente de `personalAccessTokens`, não
 * há segredo nenhum a proteger nesta tabela — uma chave pública não precisa
 * de hash nem de envelope encryption (`EnvelopeEncryptionService` é para
 * segredo SIMÉTRICO recuperável, categoria diferente).
 *
 * O lookup na verificação é por `id` (o `kid` do JWT), não pela chave em
 * si — por isso não há índice único em `publicKeyJwk`, ao contrário do
 * índice único em `tokenHash` do PAT, que existe porque ali a busca É pelo
 * valor apresentado.
 */
export const runnerDeviceKeys = pgTable(
  'runner_device_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    publicKeyJwk: text('public_key_jwk').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedReason: text('revoked_reason'),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (table) => [
    index('runner_device_keys_user_idx').on(table.userId),
    index('runner_device_keys_project_idx').on(table.projectId),
  ],
);

/**
 * Trilha de auditoria do auth — append-only (Fase 7a, item 1).
 *
 * Sem chave estrangeira para `users`, pela mesma razão registrada em
 * `rate_limit_hits`: apagar o usuário não pode apagar o registro do abuso, que
 * é justamente o que se quer preservar num incidente.
 *
 * `kind` é `text` e não pgEnum — mesma escolha de `session_events.type` e
 * `outbox_events.event_type`. Tipo de evento novo não deve custar migração; a
 * união fechada mora no TypeScript (`AuthEventKind`).
 *
 * Esta tabela NÃO é a janela do lockout. Ver `auth_lockout_hits`.
 */
export const authEvents = pgTable(
  'auth_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    kind: text('kind').notNull(),
    // `user:<uuid>` ou `email:<hmac>` — NUNCA o e-mail em claro.
    subjectKey: text('subject_key').notNull(),
    userId: uuid('user_id'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    metadata: jsonb('metadata').notNull().default({}),
    occurredAt: timestamp('occurred_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('auth_events_subject_idx').on(table.subjectKey, table.occurredAt),
    index('auth_events_kind_idx').on(table.kind, table.occurredAt),
    index('auth_events_occurred_idx').on(table.occurredAt),
  ],
);

/**
 * Janela deslizante do lockout progressivo — Fase 7a, item 2.
 *
 * ## Por que não conta dentro de auth_events
 *
 * Porque `auth_events` é append-only por regra do CLAUDE.md, e zerar o contador
 * num login bem-sucedido exige DELETE. Numa tabela só, seria preciso inventar
 * uma marca d'água ("falhas desde o último sucesso") que acopla o plano de
 * consulta do throttle ao conjunto de índices da auditoria, para sempre.
 *
 * Separadas, cada uma tem a regra que lhe cabe: esta é estado efêmero de
 * contador — igual a `rate_limit_hits`, e apagável — e aquela é história.
 * As retenções também são opostas: aqui, IP e chave derivada de e-mail viram
 * passivo de PII depois de uma hora; lá, o registro precisa sobreviver.
 *
 * ## Por que a chave é o e-mail, e não o id do usuário
 *
 * Com `user:<uuid>` o balde só existiria depois de encontrar a conta —
 * tentativa contra e-mail inexistente nunca seria contada nem bloqueada, e o
 * PRÓPRIO lockout viraria oráculo de existência (basta comparar o
 * comportamento na sexta tentativa). Com `email:<hmac>`, conta real e conta
 * imaginária se comportam igual por construção.
 */
export const authLockoutHits = pgTable(
  'auth_lockout_hits',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    // `email:<hmac>` · `ip:<endereço>` · `ipall:<endereço>` ·
    // `reset_email:<hmac>` · `reset_ip:<endereço>` · `register_ip:<endereço>`
    bucketKey: text('bucket_key').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Composto e nesta ordem, mesma razão de rate_limit_hits: a consulta é
    // sempre "quantos hits deste balde depois de T".
    index('auth_lockout_hits_bucket_idx').on(table.bucketKey, table.occurredAt),
    index('auth_lockout_hits_occurred_idx').on(table.occurredAt),
  ],
);
