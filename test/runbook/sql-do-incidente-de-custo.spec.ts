import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { createTestDb, truncateAll } from '../support/test-db';
import {
  agentAutonomy,
  budgets,
  projects,
  users,
  workspaces,
} from '../../src/db/schema';

/**
 * O SQL do "Incidente de custo" do runbook, executado contra o schema migrado
 * (AT-194).
 *
 * O passo 3(a) fazia `set mode = 'manual'` num enum que só aceita
 * `auto_approve | require_approval | deny` — e reprovava na hora, no meio do
 * incidente de gasto, que é o pior momento de descobrir. Nenhuma suíte rodava
 * aquele texto, então nada o pegou. Este arquivo EXTRAI os blocos ```sql da
 * seção, nos DOIS idiomas (o inglês de `docs/` e a tradução pt-BR do site), e
 * os executa: valor de enum inválido, coluna renomeada ou tabela que sumiu
 * reprova aqui.
 *
 * Por que extrair em vez de copiar o SQL para cá: uma cópia provaria a cópia.
 * A pergunta é se o que o operador vai colar funciona.
 */

const RAIZ = join(__dirname, '..', '..', '..', '..');
const ARQUIVOS = {
  en: join(RAIZ, 'docs', 'runbook.md'),
  'pt-BR': join(
    RAIZ,
    'website',
    'i18n',
    'pt-BR',
    'docusaurus-plugin-content-docs',
    'current',
    'runbook.md',
  ),
} as const;

/** Os blocos ```sql da seção `{#incidente-de-custo}`, em ordem. */
function blocosSqlDoIncidenteDeCusto(markdown: string): string[] {
  const linhas = markdown.split('\n');
  const inicio = linhas.findIndex(
    (l) => l.startsWith('## ') && l.includes('{#incidente-de-custo}'),
  );
  if (inicio < 0) throw new Error('seção {#incidente-de-custo} não encontrada');
  const fimRelativo = linhas
    .slice(inicio + 1)
    .findIndex((l) => l.startsWith('## '));
  const secao = linhas.slice(
    inicio + 1,
    fimRelativo < 0 ? undefined : inicio + 1 + fimRelativo,
  );

  const blocos: string[] = [];
  let atual: string[] | null = null;
  for (const linha of secao) {
    if (atual === null && linha.trim() === '```sql') atual = [];
    else if (atual !== null && linha.trim() === '```') {
      blocos.push(atual.join('\n'));
      atual = null;
    } else if (atual !== null) atual.push(linha);
  }
  return blocos;
}

const { db, pool } = createTestDb();

async function semear() {
  const [dono] = await db
    .insert(users)
    .values({ keycloakSub: 'sub-custo', email: 'custo@brabo.dev' })
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
  await db.insert(agentAutonomy).values([
    {
      projectId: projeto.id,
      agentId: 'dev-api',
      actionType: 'terminal',
      mode: 'auto_approve',
    },
    // O curinga do modo automático (RN-153) — tem de cair junto.
    {
      projectId: projeto.id,
      agentId: 'dev-web',
      actionType: '*',
      mode: 'auto_approve',
    },
    // O que alguém FECHOU — tem de continuar fechado.
    {
      projectId: projeto.id,
      agentId: 'dev-api',
      actionType: 'git_push',
      mode: 'deny',
    },
  ]);
  await db.insert(budgets).values({
    projectId: projeto.id,
    limitMicros: 50_000_000,
    spentMicros: 10_000_000,
    policy: 'allow',
  });
  return projeto.id;
}

/** Executa um bloco com o `<projeto>` do runbook trocado pelo id real. */
async function executar(bloco: string, projectId: string) {
  // O runbook escreve o placeholder entre aspas simples; a troca é literal,
  // sem interpolar nada vindo de fora do teste.
  return pool.query(bloco.replaceAll('<projeto>', projectId));
}

describe.each(Object.entries(ARQUIVOS))(
  'runbook (%s) — SQL do incidente de custo',
  (_idioma, arquivo) => {
    const blocos = blocosSqlDoIncidenteDeCusto(readFileSync(arquivo, 'utf8'));
    let projectId: string;

    beforeEach(async () => {
      await truncateAll(db);
      projectId = await semear();
    });

    it('a seção tem os cinco blocos que o procedimento descreve', () => {
      // Se um bloco sumir ou nascer, este número muda de propósito: é o
      // aviso de que o teste abaixo passou a cobrir outra coisa.
      expect(blocos).toHaveLength(5);
    });

    it('todo bloco executa contra o schema migrado', async () => {
      for (const bloco of blocos) {
        await expect(executar(bloco, projectId)).resolves.toBeDefined();
      }
    });

    it('3(a) tira do auto_approve, inclusive o curinga, e não afrouxa o deny', async () => {
      const passoA = blocos.find((b) => b.includes('update agent_autonomy'));
      expect(passoA).toBeDefined();
      await executar(passoA!, projectId);

      const linhas = await db
        .select({
          actionType: agentAutonomy.actionType,
          mode: agentAutonomy.mode,
        })
        .from(agentAutonomy)
        .where(eq(agentAutonomy.projectId, projectId));
      const porTipo = Object.fromEntries(
        linhas.map((l) => [l.actionType, l.mode]),
      );
      expect(porTipo).toEqual({
        terminal: 'require_approval',
        '*': 'require_approval',
        git_push: 'deny',
      });
    });

    it('3(c) põe o teto em block e a um dólar do gasto', async () => {
      const passoC = blocos.find((b) => b.includes('update budgets'));
      expect(passoC).toBeDefined();
      await executar(passoC!, projectId);

      const [orcamento] = await db
        .select()
        .from(budgets)
        .where(eq(budgets.projectId, projectId));
      expect(orcamento.policy).toBe('block');
      expect(orcamento.limitMicros).toBe(11_000_000);
    });
  },
);

afterAll(async () => {
  await pool.end();
});
