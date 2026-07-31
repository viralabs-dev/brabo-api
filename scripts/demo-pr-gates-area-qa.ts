/**
 * Demo do critério de aceite da ÁREA DE QA (Fase 8b, ADR 0038): numa task
 * cuja story tem RNF de performance, o QA Lead delega às DUAS
 * subespecialidades, registra cada desfecho como uma delegação, e consolida
 * num `qa_verdict` só — o MESMO artefato e a MESMA rota que
 * `demo-pr-gates.ts` já prova, sem que a api saiba que existe mais de um
 * agente por trás do parecer.
 *
 * Uso: pnpm --filter api demo:pr-gates-area-qa
 *
 * PRÉ-REQUISITOS: os mesmos de `demo-pr-gates.ts` — stack de pé, modelo
 * Ollama seedado, execução de dentro do container da api. Ver aquele arquivo
 * para o porquê de cada um.
 *
 * NÃO É DETERMINÍSTICO com modelo local, pela mesma razão de
 * `demo-pr-gates.ts`: o julgamento de CADA subespecialidade depende do
 * modelo. Rode deliberadamente, não em CI.
 *
 * ## O que este demo prova que `demo-pr-gates.ts` não prova
 *
 * Aquele mostra a SEQUÊNCIA de gates (dev → qa → secops → você) com uma
 * story SEM RNF de performance — só a subespecialidade de Automação roda, e
 * Performance/Segurança é dispensada (com justificativa, nunca em silêncio;
 * é a MESMA passagem por `QaLeadServer` — só que sem esta story dar motivo
 * pra ativá-la).
 *
 * Este planta um RNF de performance na story pra ativar as DUAS
 * delegações, e verifica:
 *
 * 1. Dois eventos `delegation.completed` (ou `delegation.failed`) — um por
 *    subespecialidade, cada um referenciando o parecer INTERNO dela.
 * 2. Nenhum `delegation.dispensed` (a diferença do caso sem RNF).
 * 3. O `qa_verdict` que a api recebe é UM só — a Automação e a
 *    Performance/Segurança nunca falam com `gates/verdict` diretamente.
 * 4. Se qualquer uma pedir mudança, `itens` do parecer final rastreia qual
 *    subespecialidade levantou cada item (prefixo `[label]`).
 *
 * ## O binding de modelo por agente mudou de nome, de propósito
 *
 * `demo-pr-gates.ts` liga o modelo mais forte ao agente `"qa"`
 * (`DEMO_QA_MODEL`) — que era o único agente de QA até a Fase 8b. Hoje quem
 * roda são `"qa-automacao"` e `"qa-performance-seguranca"`; o binding em
 * `"qa"` não erra nada (a cascata cai pro binding de projeto), só deixa de
 * ter o efeito que o comentário daquele arquivo descreve. Este demo liga o
 * modelo forte às DUAS subespecialidades explicitamente — é o jeito certo
 * de fazer isso agora, e fica registrado aqui em vez de editar o script
 * antigo (que o ADR 0038 exige ficar intocado).
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { eq, and } from 'drizzle-orm';
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
const MODELO_QA = process.env.DEMO_QA_MODEL ?? MODELO;

const MODULOS = [
  {
    name: 'busca',
    stack: 'Node.js',
    responsibility: 'busca de produtos por texto',
    dependsOn: [],
  },
];

const RF_1 = 'buscar(termo, produtos) devolve os produtos cujo nome contém o termo';

// O RNF que ativa a subespecialidade de Performance/Segurança — a palavra-
// chave é reconhecida por `Engine.Gates.QaLead.rnf_de_performance?/1`.
const RNF_PERFORMANCE =
  'Tempo de resposta abaixo de 300ms para catálogos de até 10 mil produtos.';

const AGENTS_MD = `# Convenções deste repositório

- Node.js puro, SEM dependências externas. NUNCA rode \`npm install\`.
- Código-fonte em \`src/\`, um arquivo por função, CommonJS:
  \`module.exports = { nomeDaFuncao };\`
- Testes em \`test/\`, arquivos \`*.test.js\`, com o runner nativo do Node.
- Rode a suite com exatamente: \`npm test\`
- Só use \`report_done\` DEPOIS de ver \`npm test\` terminar com exit 0.
`;

const SKELETON = [
  {
    path: 'package.json',
    content: JSON.stringify(
      {
        name: 'cobaia-area-qa',
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

const TASK_DESCRICAO = [
  'Criar src/busca.js exportando a função buscar(termo, produtos).',
  '',
  `Regra: ${RF_1}`,
  '',
  'produtos é um array de { nome }. Filtrar por substring, sem diferenciar',
  'maiúscula/minúscula.',
  '',
  'Criar test/busca.test.js cobrindo a regra.',
  '',
  'Rodar `npm test` até passar.',
].join('\n');

interface DelegationEvent {
  seq: number;
  type: string;
  payload: {
    delegationId?: string;
    subagent?: string;
    parecerArtifactId?: string | null;
    failureOrigin?: string | null;
    justification?: string | null;
  };
}

interface Parecer {
  seq: number;
  actorId: string;
  veredito: string;
  resumo: string;
  itens: string[];
}

function log(msg: string) {
  console.log(msg);
}

function delegationEvents(
  eventos: { seq: number; type: string; payload: unknown }[],
): DelegationEvent[] {
  return eventos
    .filter((e) => e.type.startsWith('delegation.'))
    .map((e) => ({
      seq: e.seq,
      type: e.type,
      payload: e.payload as DelegationEvent['payload'],
    }));
}

// `artifact.qa_verdict` é emitido em TRÊS pontos: o parecer INTERNO de cada
// subespecialidade (actorId "qa-automacao"/"qa-performance-seguranca" — nunca
// vai pro gate, só vira `delegations.parecerArtifactId`) e o CONSOLIDADO do
// Lead (actorId "qa" — o único que a api de fato vê em `gates/verdict`).
// Reaproveitar o schema em vez de criar um tipo novo é decisão do ADR 0038;
// aqui é o que obriga a filtrar por `actorId`, não só por `type`.
function qaVerdicts(
  eventos: { seq: number; type: string; actorId: string; payload: unknown }[],
): Parecer[] {
  return eventos
    .filter((e) => e.type === 'artifact.qa_verdict')
    .map((e) => {
      const p = e.payload as {
        veredito?: string;
        resumo?: string;
        itens?: string[];
      };
      return {
        seq: e.seq,
        actorId: e.actorId,
        veredito: p.veredito ?? '?',
        resumo: p.resumo ?? '',
        itens: p.itens ?? [],
      };
    });
}

/** O parecer que a api de fato vê — o consolidado do Lead, `actorId: "qa"`. */
function pareceresDoGate(pareceres: Parecer[]): Parecer[] {
  return pareceres.filter((p) => p.actorId === 'qa');
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
      keycloakSub: `demo-area-qa-${sufixo}`,
      email: `demo-area-qa-${sufixo}@brabo.dev`,
    })
    .returning();
  const [workspace] = await db
    .insert(workspaces)
    .values({ name: 'demo', slug: `demo-area-qa-${sufixo}`, createdBy: user.id })
    .returning();
  const [project] = await db
    .insert(projects)
    .values({
      workspaceId: workspace.id,
      name: 'cobaia-area-qa',
      slug: `cobaia-area-qa-${sufixo}`,
      createdBy: user.id,
    })
    .returning();
  await db
    .insert(projectMembers)
    .values({ projectId: project.id, userId: user.id, role: 'owner' });
  log(`✓ projeto-cobaia: ${project.id}`);

  const bindings = app.get(SetModelBindingUseCase);

  async function resolveModelo(nome: string) {
    const [linha] = await db
      .select()
      .from(models)
      .where(and(eq(models.provider, 'ollama'), eq(models.name, nome)));
    if (!linha) {
      throw new Error(
        `Modelo ollama/${nome} não está seedado — rode \`pnpm --filter api seed\``,
      );
    }
    return linha;
  }

  const modelo = await resolveModelo(MODELO);
  await bindings.execute('project', project.id, modelo.id, user.id);
  log(`✓ modelo do projeto: ${modelo.provider}/${modelo.name}`);

  // As DUAS subespecialidades, não o "qa" de antes da Fase 8b — ver o
  // comentário no topo do arquivo.
  const modeloQa = await resolveModelo(MODELO_QA);
  await bindings.execute('agent', 'qa-automacao', modeloQa.id, user.id);
  await bindings.execute(
    'agent',
    'qa-performance-seguranca',
    modeloQa.id,
    user.id,
  );
  log(`✓ modelo das subespecialidades de QA: ${modeloQa.provider}/${modeloQa.name}`);

  await app.get(ProvisionRepositoryUseCase).execute(project.id, user.id, {
    provider: 'local',
    name: `cobaia-area-qa-${sufixo}`,
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
  log('✓ repo provisionado com esqueleto Node');

  const sessaoArq = await sessions.create({
    projectId: project.id,
    createdBy: user.id,
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
    title: 'Busca de produtos',
  });

  const story = await stories.create({
    epicId: epic.id,
    projectId: project.id,
    sessionId: sessaoArq.id,
    title: 'Busca por texto no catálogo',
    description: 'Busca simples do módulo de catálogo.',
    rf: [RF_1],
    // O RNF de performance é o que faz o QA Lead delegar às DUAS
    // subespecialidades — sem ele, Performance/Segurança seria dispensada
    // (ver `demo-pr-gates.ts`, que não tem RNF de performance nenhum).
    rnf: [RNF_PERFORMANCE, 'Sem dependências externas.'],
    dod: ['npm test passa (exit 0)', 'função exportada em src/'],
    dor: ['comportamento descrito na task'],
  });
  await stories.updateModules(story.id, ['busca']);
  await stories.updateStatus(story.id, 'ready');

  const task = await taskRepo.create({
    storyId: story.id,
    title: 'Implementar buscar(termo, produtos)',
    description: TASK_DESCRICAO,
  });
  log(`✓ 1 story (RNF de performance) + 1 task`);

  log('\n--- ativando a execução (DevAgent real, LLM local) ---');
  const { sessionId } = await app
    .get(ActivateExecutionUseCase)
    .execute(project.id, user.id, 5_000_000, 3, 'real');
  log(`✓ sessão: ${sessionId}`);

  const limite = Date.now() + Number(process.env.DEMO_TIMEOUT_MS ?? 1_800_000);
  let ultimoResumo = '';
  let atual!: typeof tasksTable.$inferSelect;

  for (;;) {
    const [linha] = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, task.id));
    atual = linha;

    const eventos = await db
      .select()
      .from(sessionEvents)
      .where(eq(sessionEvents.sessionId, sessionId));
    const delegacoes = delegationEvents(eventos).length;
    const pareceres = pareceresDoGate(qaVerdicts(eventos)).length;

    const resumo = `${atual.status} gate=${atual.gateStatus ?? '-'} delegações=${delegacoes} parecer_final=${pareceres}${atual.blocked ? ' (BLOCKED)' : ''}`;
    if (resumo !== ultimoResumo) {
      log(`  ${resumo}`);
      ultimoResumo = resumo;
    }

    // Termina assim que o gate de QA decidir (avança pro SecOps, ou bloqueia)
    // — não esperamos o SecOps aqui, o que importa é a área de QA.
    const terminou =
      atual.gateStatus === 'awaiting_secops' ||
      atual.gateStatus === 'awaiting_user' ||
      atual.blocked;
    if (terminou || Date.now() > limite) break;
    await new Promise((r) => setTimeout(r, 5_000));
  }

  log('\n--- delegações da área de QA ---');
  const eventosFinal = (
    await db
      .select()
      .from(sessionEvents)
      .where(eq(sessionEvents.sessionId, sessionId))
  ).sort((a, b) => a.seq - b.seq);

  const delegacoes = delegationEvents(eventosFinal);
  for (const d of delegacoes) {
    const tipo = d.type.replace('delegation.', '');
    log(`  ${d.payload.subagent}: ${tipo}`);
    if (d.payload.parecerArtifactId) log(`    parecer: ${d.payload.parecerArtifactId}`);
    if (d.payload.failureOrigin) log(`    origem da falha: ${d.payload.failureOrigin}`);
    if (d.payload.justification) log(`    justificativa: ${d.payload.justification}`);
  }

  log('\n--- parecer final (o único que a api vê) ---');
  const pareceres = pareceresDoGate(qaVerdicts(eventosFinal));
  for (const p of pareceres) {
    log(`qa → ${p.veredito}: ${p.resumo}`);
    for (const item of p.itens) log(`     - ${item}`);
  }

  // --- Critério de aceite ---
  log('\n--- critério de aceite ---');
  const falhas: string[] = [];

  const subagentesQueDelegaram = new Set(
    delegacoes.map((d) => d.payload.subagent),
  );
  if (!subagentesQueDelegaram.has('qa-automacao')) {
    falhas.push('QA de Automação não delegou (esperado sempre)');
  }
  if (!subagentesQueDelegaram.has('qa-performance-seguranca')) {
    falhas.push(
      'QA de Performance e Segurança não delegou (esperado: story tem RNF de performance)',
    );
  }
  const dispensas = delegacoes.filter((d) => d.type === 'delegation.dispensed');
  if (dispensas.length > 0) {
    falhas.push(
      `${dispensas.length} delegação(ões) dispensada(s) — não esperado com RNF de performance na story`,
    );
  }
  if (pareceres.length !== 1) {
    falhas.push(
      `${pareceres.length} evento(s) qa_verdict de GATE — esperado exatamente 1 (o consolidado; os pareceres internos das subespecialidades não contam, são outro agentId)`,
    );
  }
  if (atual.blocked) {
    falhas.push(`task bloqueada: ${atual.blockedReason ?? '(sem motivo)'}`);
  }

  await app.close();

  if (falhas.length > 0) {
    log('✗ NÃO fechou:');
    for (const f of falhas) log(`  - ${f}`);
    log(`\nProjeto pra inspeção: ${project.id}`);
    process.exit(1);
  }

  log(
    '✓ as duas subespecialidades delegaram, e a api recebeu UM parecer consolidado',
  );
  log(`\nProjeto: ${project.id}`);
}

main().catch((error) => {
  console.error('\nDemo falhou:', error);
  process.exit(1);
});
