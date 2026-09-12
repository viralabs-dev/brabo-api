import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { createTestDb, truncateAll } from '../support/test-db';
import {
  projectGitConnections,
  projects,
  userCredentials,
  users,
  workspaces,
} from '../../src/db/schema';
import { reenvelopar } from '../../src/scripts/rewrap-deks';
import { EnvelopeEncryptionService } from '../../src/infrastructure/security/envelope-encryption.service';
import type { EncryptedSecret } from '../../src/application/ports/encryption.port';

/**
 * A coexistência das duas chaves, provada contra as DUAS tabelas (RN-562).
 *
 * O que este arquivo cobre e o spec do serviço
 * (`test/infrastructure/security/envelope-encryption.service.spec.ts`) NÃO
 * cobre: aquele exercita `encrypt`/`decrypt`/`rewrap` em memória, e por isso
 * não prova que o SCRIPT percorre `user_credentials` **e**
 * `project_git_connections`. Mexer numa só produziria uma rotação que
 * converte metade do acervo e reporta sucesso — e o passo 3 do runbook
 * ("descarte a chave velha") tornaria a outra metade ilegível para sempre.
 *
 * A sequência exercitada é a do runbook, inteira:
 * K1 → publica K2 → reenvelopa → descarta K1 → ainda abre.
 *
 * Nenhuma chave e nenhum segredo é literal neste arquivo: os dois nascem de
 * `randomBytes` a cada rodada. Uma passphrase constante num fixture é uma
 * string com cara de segredo indo para o histórico do git, e o gitleaks varre
 * branches — o custo de gerar em runtime é zero e o de limpar não é.
 */

const { db, pool } = createTestDb();

/** Uma passphrase de mestra, aleatória por rodada. Nunca vai para o disco. */
function passphrase(): string {
  return randomBytes(24).toString('hex');
}

/** Um "segredo do usuário" de mentira, aleatório por rodada. */
function segredo(prefixo: string): string {
  return `${prefixo}-${randomBytes(16).toString('hex')}`;
}

/**
 * Instancia o cofre com um par de chaves explícito.
 *
 * O construtor lê `process.env` (`envelope-encryption.service.ts:62-69`), então
 * cada estado da rotação é uma INSTÂNCIA nova — nunca um singleton mutado.
 */
function cofreCom(atual: string, anterior?: string): EnvelopeEncryptionService {
  process.env.CREDENTIALS_MASTER_KEY = atual;
  if (anterior === undefined)
    delete process.env.CREDENTIALS_MASTER_KEY_PREVIOUS;
  else process.env.CREDENTIALS_MASTER_KEY_PREVIOUS = anterior;
  return new EnvelopeEncryptionService();
}

interface Cenario {
  credencialId: string;
  conexaoId: string;
  chaveDeLlm: string;
  tokenDeGit: string;
}

async function semear(cofre: EnvelopeEncryptionService): Promise<Cenario> {
  const [dono] = await db
    .insert(users)
    .values({ keycloakSub: 'sub-rewrap', email: 'rewrap@brabo.dev' })
    .returning();
  const [ws] = await db
    .insert(workspaces)
    .values({ name: 'acme', slug: 'acme', createdBy: dono.id })
    .returning();
  const [projeto] = await db
    .insert(projects)
    .values({
      workspaceId: ws.id,
      name: 'core',
      slug: 'core',
      createdBy: dono.id,
    })
    .returning();

  const chaveDeLlm = segredo('sk-ant');
  const tokenDeGit = segredo('ghp');

  const [credencial] = await db
    .insert(userCredentials)
    .values({
      userId: dono.id,
      provider: 'anthropic',
      ...cofre.encrypt(chaveDeLlm),
    })
    .returning();
  const [conexao] = await db
    .insert(projectGitConnections)
    .values({
      projectId: projeto.id,
      provider: 'github',
      connectedBy: dono.id,
      ...cofre.encrypt(tokenDeGit),
    })
    .returning();

  return {
    credencialId: credencial.id,
    conexaoId: conexao.id,
    chaveDeLlm,
    tokenDeGit,
  };
}

async function envelopeDaCredencial(id: string): Promise<EncryptedSecret> {
  const [linha] = await db
    .select()
    .from(userCredentials)
    .where(eq(userCredentials.id, id));
  return linha;
}

async function envelopeDaConexao(id: string): Promise<EncryptedSecret> {
  const [linha] = await db
    .select()
    .from(projectGitConnections)
    .where(eq(projectGitConnections.id, id));
  return linha;
}

/**
 * A consulta do passo 2 do runbook, exercitada como SQL de verdade (ADR 0158).
 *
 * `IS DISTINCT FROM` e nunca `<>`: com `<>`, a linha de `key_id` NULO — o
 * acervo anterior à coluna — sumiria da contagem, e "não sei qual chave" viraria
 * "já está na atual", que é a leitura que faria alguém descartar a chave velha
 * cedo demais.
 */
async function pendentes(keyIdAtual: string): Promise<number> {
  const { rows } = await db.execute<{ pendentes: string }>(sql`
    select
      (select count(*) from user_credentials
        where key_id is distinct from ${keyIdAtual})
      +
      (select count(*) from project_git_connections
        where key_id is distinct from ${keyIdAtual}) as pendentes
  `);
  return Number(rows[0].pendentes);
}

function porTabela(resultados: Awaited<ReturnType<typeof reenvelopar>>) {
  return Object.fromEntries(resultados.map((r) => [r.tabela, r]));
}

describe('rewrap-deks: a rotação da chave mestra, ponta a ponta', () => {
  const chaveEnvOriginal = process.env.CREDENTIALS_MASTER_KEY;
  const anteriorEnvOriginal = process.env.CREDENTIALS_MASTER_KEY_PREVIOUS;

  beforeEach(async () => {
    await truncateAll(db);
  });

  afterAll(async () => {
    if (chaveEnvOriginal === undefined)
      delete process.env.CREDENTIALS_MASTER_KEY;
    else process.env.CREDENTIALS_MASTER_KEY = chaveEnvOriginal;
    if (anteriorEnvOriginal === undefined)
      delete process.env.CREDENTIALS_MASTER_KEY_PREVIOUS;
    else process.env.CREDENTIALS_MASTER_KEY_PREVIOUS = anteriorEnvOriginal;
    await pool.end();
  });

  it('caminho feliz: cifra com K1, publica K2, reenvelopa, descarta K1 e ainda decifra', async () => {
    const k1 = passphrase();
    const k2 = passphrase();

    // Passo 0 — o acervo nasce na chave antiga, nas duas tabelas.
    const cenario = await semear(cofreCom(k1));
    const antesCredencial = await envelopeDaCredencial(cenario.credencialId);
    const antesConexao = await envelopeDaConexao(cenario.conexaoId);

    // Passo 1 — as duas chaves coexistem. Nada quebrou: o acervo velho abre.
    const durante = cofreCom(k2, k1);
    expect(durante.decrypt(antesCredencial)).toBe(cenario.chaveDeLlm);
    expect(durante.decrypt(antesConexao)).toBe(cenario.tokenDeGit);

    // Passo 2 — o reenvelopamento, que é o que este arquivo existe para provar
    // que toca AS DUAS tabelas.
    const resultados = porTabela(await reenvelopar(db, durante));
    expect(resultados.user_credentials).toMatchObject({
      total: 1,
      reembrulhados: 1,
      jaAtual: 0,
      falhas: 0,
    });
    expect(resultados.project_git_connections).toMatchObject({
      total: 1,
      reembrulhados: 1,
      jaAtual: 0,
      falhas: 0,
    });

    const depoisCredencial = await envelopeDaCredencial(cenario.credencialId);
    const depoisConexao = await envelopeDaConexao(cenario.conexaoId);

    // O ENVELOPE mudou nas duas...
    expect(depoisCredencial.wrappedDek).not.toBe(antesCredencial.wrappedDek);
    expect(depoisConexao.wrappedDek).not.toBe(antesConexao.wrappedDek);
    // ...e o texto cifrado do segredo NÃO. É o que permite interromper o
    // script no meio sem deixar o acervo inconsistente.
    expect(depoisCredencial.encryptedApiKey).toBe(
      antesCredencial.encryptedApiKey,
    );
    expect(depoisConexao.encryptedApiKey).toBe(antesConexao.encryptedApiKey);

    // Passo 3 — K1 descartada. É aqui que uma rotação pela metade cobraria.
    const depois = cofreCom(k2);
    expect(depois.decrypt(depoisCredencial)).toBe(cenario.chaveDeLlm);
    expect(depois.decrypt(depoisConexao)).toBe(cenario.tokenDeGit);
  });

  it('idempotência: a segunda rodada reporta re-embrulhados=0 nas duas tabelas', async () => {
    const k1 = passphrase();
    const k2 = passphrase();

    await semear(cofreCom(k1));
    const durante = cofreCom(k2, k1);

    const primeira = porTabela(await reenvelopar(db, durante));
    expect(primeira.user_credentials.reembrulhados).toBe(1);
    expect(primeira.project_git_connections.reembrulhados).toBe(1);

    const segunda = porTabela(await reenvelopar(db, durante));
    expect(segunda.user_credentials).toMatchObject({
      total: 1,
      reembrulhados: 0,
      jaAtual: 1,
      falhas: 0,
    });
    expect(segunda.project_git_connections).toMatchObject({
      total: 1,
      reembrulhados: 0,
      jaAtual: 1,
      falhas: 0,
    });
  });

  /**
   * A consulta de progresso do passo 2 do runbook (ADR 0158, RN-563).
   *
   * O critério do BRB-016 é justamente este: responder "quantas credenciais
   * ainda estão na chave anterior?" com uma CONSULTA, em vez de rodar o
   * script de novo e ler a contagem que ele imprime.
   */
  it('o key_id torna o progresso da rotação consultável nas duas tabelas', async () => {
    const k1 = passphrase();
    const k2 = passphrase();

    const cenario = await semear(cofreCom(k1));
    const antes = cofreCom(k1);
    const durante = cofreCom(k2, k1);

    // Antes da rotação: as linhas nasceram na chave VELHA e dizem isso.
    expect((await envelopeDaCredencial(cenario.credencialId)).keyId).toBe(
      antes.keyId,
    );
    expect((await envelopeDaConexao(cenario.conexaoId)).keyId).toBe(
      antes.keyId,
    );
    expect(await pendentes(durante.keyId)).toBe(2);

    await reenvelopar(db, durante);

    // Depois: a consulta responde ZERO, que é o que libera o passo 3.
    expect(await pendentes(durante.keyId)).toBe(0);
    expect((await envelopeDaCredencial(cenario.credencialId)).keyId).toBe(
      durante.keyId,
    );
    expect((await envelopeDaConexao(cenario.conexaoId)).keyId).toBe(
      durante.keyId,
    );
  });

  it('linha SEM key_id conta como pendente, nunca como "já na chave atual"', async () => {
    const k1 = passphrase();
    const k2 = passphrase();
    const cenario = await semear(cofreCom(k1));

    // O acervo de antes da RN-563: envelope legítimo, rótulo ausente.
    await db
      .update(userCredentials)
      .set({ keyId: null })
      .where(eq(userCredentials.id, cenario.credencialId));

    const durante = cofreCom(k2, k1);
    // `null` NÃO é lido como "está na chave atual" — é `IS DISTINCT FROM`, e
    // não `<>`, que descartaria a linha em silêncio.
    expect(await pendentes(durante.keyId)).toBe(2);

    await reenvelopar(db, durante);
    expect(await pendentes(durante.keyId)).toBe(0);
  });

  it('caso de falha: linha de outro ambiente é contada, identificada e não aborta as demais', async () => {
    const k1 = passphrase();
    const k2 = passphrase();
    const outroAmbiente = passphrase();

    const cenario = await semear(cofreCom(k1));

    // Uma segunda credencial embrulhada por uma TERCEIRA chave — o cenário que
    // o runbook chama de "linha vinda de outro ambiente".
    const [outroDono] = await db
      .insert(users)
      .values({ keycloakSub: 'sub-orfa', email: 'orfa@brabo.dev' })
      .returning();
    const segredoOrfao = segredo('sk-orfa');
    const [orfa] = await db
      .insert(userCredentials)
      .values({
        userId: outroDono.id,
        provider: 'openai',
        ...cofreCom(outroAmbiente).encrypt(segredoOrfao),
      })
      .returning();

    const falhas: string[] = [];
    const durante = cofreCom(k2, k1);
    const resultados = porTabela(
      await reenvelopar(db, durante, (m) => falhas.push(m)),
    );

    // A linha ilegível NÃO impediu a outra da mesma tabela, nem a outra tabela.
    expect(resultados.user_credentials).toMatchObject({
      total: 2,
      reembrulhados: 1,
      jaAtual: 0,
      falhas: 1,
    });
    expect(resultados.project_git_connections).toMatchObject({
      total: 1,
      reembrulhados: 1,
      falhas: 0,
    });

    // Ela é IDENTIFICADA por tabela e id...
    expect(falhas).toHaveLength(1);
    expect(falhas[0]).toContain('user_credentials');
    expect(falhas[0]).toContain(orfa.id);
    // ...e o relato NÃO carrega segredo nenhum, nem o da linha que não abriu.
    expect(falhas[0]).not.toContain(segredoOrfao);
    expect(falhas[0]).not.toContain(cenario.chaveDeLlm);
    expect(falhas[0]).not.toContain(k1);
    expect(falhas[0]).not.toContain(k2);
    expect(falhas[0]).not.toContain(outroAmbiente);

    // E o acervo ficou coerente: a órfã segue no envelope antigo, intocada.
    const depoisOrfa = await envelopeDaCredencial(orfa.id);
    expect(depoisOrfa.wrappedDek).toBe(orfa.wrappedDek);
  });
});
