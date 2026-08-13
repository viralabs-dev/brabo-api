/**
 * Demo do critério de aceite da Fase 4a (DevAgent real): num projeto-cobaia
 * descartável com module_map simples e 2 tasks pequenas REAIS, os dev agents
 * implementam via LLM, rodam a suite, e só abrem PR se ela passar. O merge é
 * manual do usuário.
 *
 * Uso: pnpm --filter api demo:dev-agent-real
 *
 * PRÉ-REQUISITOS: stack do Compose de pé e um modelo capaz servido pelo Ollama
 * (`docker compose exec ollama ollama pull qwen2.5-coder:7b`). O script precisa
 * rodar DE DENTRO do container da api, que compartilha /data com o engine.
 *
 * O repo-cobaia é Node puro SEM dependências (runner nativo `node --test`):
 * a suite roda no container do engine, que é onde o `terminal` do agente
 * executa — daí o node instalado na imagem, e daí não haver `npm install`.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { eq, and, inArray } from 'drizzle-orm';
import { AppModule } from '../src/app.module';
import {
  DRIZZLE,
  type DrizzleDb,
} from '../src/infrastructure/persistence/drizzle/drizzle-client';
import {
  users,
  workspaces,
  projects,
  projectMembers,
  proposedActions,
  sessionEvents,
  models,
  tasks as tasksTable,
} from '../src/db/schema';
import { ProvisionRepositoryUseCase } from '../src/application/use-cases/git/provision-repository.use-case';
import { ActivateExecutionUseCase } from '../src/application/use-cases/execution/activate-execution.use-case';
import { SetModelBindingUseCase } from '../src/application/use-cases/llm/set-model-binding.use-case';
import { SessionRepository } from '../src/application/ports/session-repository.port';
import { ModuleMapRepository } from '../src/application/ports/module-map-repository.port';
import {
  EpicRepository,
  StoryRepository,
  TaskRepository,
} from '../src/application/ports/backlog-repository.port';
import { ProvisionedRepositoryRepository } from '../src/application/ports/provisioned-repository-repository.port';
import { GitProviderRegistry } from '../src/application/ports/git-provider.port';

const MODELO = process.env.DEMO_MODEL ?? 'qwen2.5-coder:7b';

const MODULOS = [
  {
    name: 'core',
    stack: 'Node.js',
    responsibility: 'funções de cálculo',
    dependsOn: [],
  },
  {
    name: 'texto',
    stack: 'Node.js',
    responsibility: 'funções de manipulação de texto',
    dependsOn: [],
  },
];

const AGENTS_MD = `# Convenções deste repositório

- Node.js puro, SEM dependências externas. NUNCA rode \`npm install\`.
- Código-fonte em \`src/\`, um arquivo por função, CommonJS:
  \`module.exports = { nomeDaFuncao };\`
- Testes em \`test/\`, arquivos \`*.test.js\`, com o runner nativo do Node:

\`\`\`js
const test = require('node:test');
const assert = require('node:assert');
const { nomeDaFuncao } = require('../src/nome-do-arquivo');

test('descrição', () => {
  assert.strictEqual(nomeDaFuncao(1, 2), 3);
});
\`\`\`

- Rode a suite com exatamente: \`npm test\`
- Só use \`report_done\` DEPOIS de ver \`npm test\` terminar com exit 0.
`;

const SKELETON = [
  {
    path: 'package.json',
    content: JSON.stringify(
      {
        name: 'cobaia',
        version: '1.0.0',
        private: true,
        scripts: { test: 'node --test' },
      },
      null,
      2,
    ),
  },
  { path: 'AGENTS.md', content: AGENTS_MD },
  {
    path: 'test/smoke.test.js',
    content: `const test = require('node:test');
const assert = require('node:assert');

test('a suite roda', () => {
  assert.strictEqual(1 + 1, 2);
});
`,
  },
];

const BACKLOG = [
  {
    modulo: 'core',
    story: 'Operações aritméticas',
    task: 'Implementar soma(a, b)',
    descricao:
      'Criar src/soma.js exportando a função soma(a, b) que devolve a + b, ' +
      'e test/soma.test.js cobrindo o caso feliz. Rodar `npm test` até passar.',
  },
  {
    modulo: 'texto',
    story: 'Manipulação de texto',
    task: 'Implementar inverte(texto)',
    descricao:
      'Criar src/inverte.js exportando a função inverte(texto) que devolve a ' +
      'string invertida, e test/inverte.test.js cobrindo o caso feliz. ' +
      'Rodar `npm test` até passar.',
  },
];

function log(msg: string) {
  console.log(msg);
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error'],
  });
  const db = app.get<DrizzleDb>(DRIZZLE);
  const sessions = app.get(SessionRepository);
  const moduleMaps = app.get(ModuleMapRepository);
  const epics = app.get(EpicRepository);
  const stories = app.get(StoryRepository);
  const taskRepo = app.get(TaskRepository);
  const repos = app.get(ProvisionedRepositoryRepository);
  const registry = app.get(GitProviderRegistry);

  const sufixo = Date.now();

  const [user] = await db
    .insert(users)
    .values({
      keycloakSub: `demo-dev-${sufixo}`,
      email: `demo-dev-${sufixo}@brabo.dev`,
    })
    .returning();
  const [workspace] = await db
    .insert(workspaces)
    .values({ name: 'demo', slug: `demo-dev-${sufixo}`, createdBy: user.id })
    .returning();
  const [project] = await db
    .insert(projects)
    .values({
      workspaceId: workspace.id,
      name: 'cobaia-dev-agent',
      slug: `cobaia-dev-agent-${sufixo}`,
      createdBy: user.id,
    })
    .returning();
  await db
    .insert(projectMembers)
    .values({ projectId: project.id, userId: user.id, role: 'owner' });
  log(`✓ projeto-cobaia: ${project.id}`);

  // --- Modelo: os dev agents precisam de um binding resolvível ---
  const [modelo] = await db
    .select()
    .from(models)
    .where(and(eq(models.provider, 'ollama'), eq(models.name, MODELO)));
  if (!modelo) {
    throw new Error(
      `Modelo ollama/${MODELO} não está seedado — rode \`pnpm --filter api seed\``,
    );
  }
  await app
    .get(SetModelBindingUseCase)
    .execute('project', project.id, modelo.id, user.id);
  log(`✓ modelo ligado ao projeto: ${modelo.provider}/${modelo.name}`);

  // --- Repo com esqueleto Node (a suite precisa existir pra poder passar) ---
  await app.get(ProvisionRepositoryUseCase).execute(project.id, user.id, {
    provider: 'local',
    name: `cobaia-${sufixo}`,
    visibility: 'private',
  });
  const repo = await repos.findByProjectId(project.id);
  if (!repo) throw new Error('repo não provisionado');

  await registry.get('local').commitFiles({
    externalId: repo.externalId,
    branch: repo.defaultBranch,
    message: 'chore: esqueleto do projeto-cobaia',
    files: SKELETON,
    accessToken: '',
  });
  log(`✓ repo provisionado com esqueleto Node (npm test verde de saída)`);

  // --- module_map + backlog ---
  const sessaoArq = await sessions.create({
    projectId: project.id,
    createdBy: user.id,
    // Demo/roteiro exercita o caminho de EXECUÇÃO — `criativa` (RN-097).
    kind: 'criativa' as const,
  });
  await moduleMaps.create({
    projectId: project.id,
    sessionId: sessaoArq.id,
    modules: MODULOS,
    version: 1,
  });

  const epic = await epics.create({
    projectId: project.id,
    sessionId: sessaoArq.id,
    title: 'Utilitários',
  });

  const taskIds: string[] = [];
  for (const item of BACKLOG) {
    const story = await stories.create({
      epicId: epic.id,
      projectId: project.id,
      sessionId: sessaoArq.id,
      title: item.story,
      description: `Funções do módulo ${item.modulo}.`,
      rf: [`A função deve estar exportada e coberta por teste.`],
      rnf: ['Sem dependências externas.'],
      dod: ['npm test passa (exit 0)', 'função exportada em src/'],
      dor: ['comportamento descrito na task'],
    });
    await stories.updateModules(story.id, [item.modulo]);
    await stories.updateStatus(story.id, 'ready');
    const t = await taskRepo.create({
      storyId: story.id,
      title: item.task,
      description: item.descricao,
    });
    taskIds.push(t.id);
  }
  log(
    `✓ module_map (${MODULOS.map((m) => m.name).join(', ')}) + 2 tasks reais`,
  );

  // --- Ativação: DevAgent REAL ---
  log('\n--- ativando a execução (DevAgent real, LLM local) ---');
  const { sessionId } = await app
    .get(ActivateExecutionUseCase)
    .execute(project.id, user.id, 2_000_000, undefined, 'real');
  log(`✓ sessão: ${sessionId}`);

  // --- Acompanhamento ---
  const limite = Date.now() + Number(process.env.DEMO_TIMEOUT_MS ?? 900_000);
  let ultimoResumo = '';
  for (;;) {
    const nossas = await db
      .select()
      .from(tasksTable)
      .where(inArray(tasksTable.id, taskIds));
    const prs = await db
      .select()
      .from(proposedActions)
      .where(
        and(
          eq(proposedActions.projectId, project.id),
          eq(proposedActions.actionType, 'pr_open'),
        ),
      );

    const resumo = nossas
      .map((t) => `${t.title}: ${t.status}${t.blocked ? ' (BLOCKED)' : ''}`)
      .join(' | ');
    if (resumo !== ultimoResumo) {
      log(`  ${resumo}  — PRs: ${prs.length}`);
      ultimoResumo = resumo;
    }

    const terminou = nossas.every((t) => t.status === 'in_review' || t.blocked);
    if (terminou || Date.now() > limite) break;
    await new Promise((r) => setTimeout(r, 5_000));
  }

  // --- Resultado ---
  log('\n--- resultado ---');
  const finais = await db
    .select()
    .from(tasksTable)
    .where(inArray(tasksTable.id, taskIds));

  for (const t of finais) {
    if (t.blocked) {
      log(`✗ ${t.title}: BLOQUEADA — ${t.blockedReason}`);
    } else {
      log(`✓ ${t.title}: ${t.status}`);
    }
  }

  const prs = await db
    .select()
    .from(proposedActions)
    .where(
      and(
        eq(proposedActions.projectId, project.id),
        eq(proposedActions.actionType, 'pr_open'),
      ),
    );
  for (const pr of prs) {
    const p = pr.payload as Record<string, unknown>;
    const r = pr.executionResult as Record<string, unknown> | null;
    log(
      `PR de ${pr.actorId}: ${String(p.sourceBranch)} status=${pr.status} url=${String(r?.pullRequestUrl ?? '-')}`,
    );
  }

  // Custo por task: o acumulado do ToolLoop no último agent.response de cada dev.
  const eventos = await db
    .select()
    .from(sessionEvents)
    .where(eq(sessionEvents.sessionId, sessionId));
  eventos.sort((a, b) => a.seq - b.seq);

  const custo = new Map<string, number>();
  for (const e of eventos) {
    if (e.type === 'agent.response' && e.actorId.startsWith('dev-')) {
      const p = e.payload as { tokensSpentMicros?: number };
      custo.set(e.actorId, p.tokensSpentMicros ?? 0);
    }
  }
  log('\ncusto por task (acumulado do ciclo):');
  for (const [agente, micros] of custo) {
    log(`  ${agente}: US$ ${(micros / 1_000_000).toFixed(4)}`);
  }

  log('\n--- event log ---');
  for (const e of eventos) {
    if (e.type === 'agent.response' || e.type === 'tool.call') continue;
    log(`#${e.seq} ${e.type} ${JSON.stringify(e.payload).slice(0, 220)}`);
  }

  log(
    `\nO merge é manual: revise as PRs e mergeie você. Projeto: ${project.id}`,
  );

  await app.close();
}

main().catch((error) => {
  console.error('\nDemo falhou:', error);
  process.exit(1);
});
