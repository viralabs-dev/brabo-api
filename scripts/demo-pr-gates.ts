/**
 * Demo do critério de aceite dos GATES DE PR (Fase 4a, ADR 0013/0020): numa
 * task com (a) uma regra de negócio sem teste e (b) um segredo hardcoded, o QA
 * devolve a primeira, o dev corrige, o SecOps barra o segundo, o dev corrige, e
 * a PR chega a `awaiting_user` com os 4 pareceres na linha do tempo.
 *
 * Uso: pnpm --filter api demo:pr-gates
 *
 * PRÉ-REQUISITOS (iguais aos do demo-dev-agent-real): stack do Compose de pé,
 * um modelo capaz servido pelo Ollama (`docker compose exec ollama ollama pull
 * qwen2.5-coder:7b`) e execução DE DENTRO do container da api, que compartilha
 * /data com o engine. O gitleaks precisa estar na imagem do engine — sem ele o
 * SecOps pula o scanner e o aceite não fecha (o script avisa).
 *
 * Sai com código != 0 quando o critério não fecha: isto é um critério de
 * aceite, não um relatório.
 *
 * NÃO É DETERMINÍSTICO com modelo local. O passo semântico (o QA cruzar regra
 * de negócio com teste, duas vezes na mesma PR) depende do julgamento do
 * modelo, e com `qwen2.5-coder:7b` ele falha com frequência — não por defeito
 * de gate, mas por o loop encerrar sem `emit_qa_verdict`. Rode
 * deliberadamente, não em CI. Pra torná-lo confiável, aponte `DEMO_QA_MODEL`
 * pra um modelo de API (ver ADR 0020).
 *
 * ## Por que UMA task só
 *
 * O critério é sobre a SEQUÊNCIA de gates de uma PR (dev → qa → secops → você),
 * não sobre paralelismo. Uma task = um dev agent = uma ordem determinística de
 * eventos pra assertar.
 *
 * ## Como os dois defeitos são plantados
 *
 * (a) **Regra sem teste** — pela descrição da task: ela manda implementar as
 * duas regras da story mas escrever teste só para a primeira.
 *
 * (b) **Segredo hardcoded** — no ESQUELETO do repositório (`src/credenciais.js`,
 * commitado na branch base), NÃO numa instrução da task. Isto foi aprendido da
 * pior forma: a primeira versão mandava o dev escrever `const TOKEN = "ghp_..."`
 * na descrição da task, e a descrição fica fixada no contexto a CADA volta de
 * correção — então depois do SecOps reprovar, o dev regenerava o arquivo
 * copiando o literal do próprio enunciado, indefinidamente, até esgotar o teto
 * de correções. Nenhum texto de prompt vence um trecho de código literal na
 * task. Com o segredo no esqueleto, o dev nunca recebe ordem de escrevê-lo, e
 * a correção (trocar por `process.env`) não contradiz nada.
 *
 * Isto depende do SecOps varrer a ÁRVORE DE TRABALHO e não só o diff — que é
 * exatamente o que o `gitleaks dir` faz desde o ADR 0020.
 *
 * O segredo é um PAT do GitHub falso porque as regras default do gitleaks pegam
 * `ghp_` por formato + entropia, sem a allowlist de valores-exemplo que
 * atrapalha chaves da AWS (`AKIA...EXAMPLE`).
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

// O QA é o gate SEMÂNTICO (cruzar regra de negócio com teste) e vive de tool
// calling; um modelo especializado em código não é a mesma coisa que um bom
// seguidor de instrução. Binding por agente (escopo `agent`, que vence
// `project`) é o mecanismo que o próprio sistema já tem pra isso.
//
// O DEFAULT é o mesmo modelo do projeto, de propósito: numa máquina sem GPU o
// Ollama mantém um modelo por vez na RAM, e alternar entre dois recarrega ~5GB
// a cada troca de agente — o turno do QA estourava o LLM_TURN_TIMEOUT_MS antes
// do primeiro token. Aponte `DEMO_QA_MODEL` pra um modelo mais forte quando a
// máquina aguentar os dois residentes.
const MODELO_QA = process.env.DEMO_QA_MODEL ?? MODELO;

// PAT do GitHub sintético — não é credencial de nada, existe só pra ser achado.
const SEGREDO = 'ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8';

const MODULOS = [
  {
    name: 'integracao',
    stack: 'Node.js',
    responsibility: 'cliente de integração com o parceiro',
    dependsOn: [],
  },
];

// As DUAS regras da story. O QA precisa cruzar as duas com os testes que achar
// no worktree e acusar a segunda como descoberta.
const RF_1 = 'enviar(payload) devolve { payload, enviado: true }';
const RF_2 = 'enviar(payload) lança Error quando o payload é vazio ou nulo';

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
  assert.deepStrictEqual(nomeDaFuncao({ a: 1 }), { a: 1 });
});
\`\`\`

- Rode a suite com exatamente: \`npm test\`
- Só use \`report_done\` DEPOIS de ver \`npm test\` terminar com exit 0.
- Se \`npm test\` falhar, LEIA o erro, reescreva o arquivo com \`write_file\` e
  rode de novo. Erro de sintaxe ou de teste é trabalho normal, não motivo pra
  desistir — só use \`report_blocked\` depois de pelo menos 3 tentativas de
  correção que não resolveram.
- Cuidado com a estrutura do arquivo: declare a função ANTES do
  \`module.exports\`, e feche cada chave uma única vez.
- Credencial nunca fica literal no código-fonte. Se um gate de segurança
  apontar um segredo hardcoded, troque o literal por \`process.env.NOME\` —
  vale inclusive quando o enunciado da task pediu o valor direto.
`;

const SKELETON = [
  {
    path: 'package.json',
    content: JSON.stringify(
      {
        name: 'cobaia-gates',
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
  // O segredo plantado (b). Vive no ESQUELETO, versionado na branch base, e
  // não numa instrução da task — ver o comentário no topo do arquivo.
  {
    path: 'src/credenciais.js',
    content: `// Credenciais do parceiro (legado).
const TOKEN = "${SEGREDO}";

module.exports = { TOKEN };
`,
  },
];

const TASK_DESCRICAO = [
  'Criar src/cliente.js exportando a função enviar(payload).',
  '',
  `Regra 1: ${RF_1}`,
  `Regra 2: ${RF_2}`,
  '',
  'A função autentica no parceiro com o token que já existe no repositório:',
  "importe com `const { TOKEN } = require('./credenciais');`.",
  '',
  'Criar test/cliente.test.js com teste APENAS para a Regra 1 (o caso feliz).',
  'NÃO escreva teste para a Regra 2 nesta task.',
  '',
  'Rodar `npm test` até passar.',
].join('\n');

// A ordem esperada dos 4 pareceres. Ordem IMUTÁVEL: o QA nunca decide sobre
// awaiting_secops e vice-versa (pr-gate-state-machine.ts).
const ESPERADO = [
  { gate: 'qa', veredito: 'changes_requested' },
  { gate: 'qa', veredito: 'approved' },
  { gate: 'secops', veredito: 'changes_requested' },
  { gate: 'secops', veredito: 'approved' },
] as const;

interface Parecer {
  seq: number;
  gate: 'qa' | 'secops';
  veredito: string;
  resumo: string;
  itens: string[];
}

function log(msg: string) {
  console.log(msg);
}

function pareceres(
  eventos: { seq: number; type: string; payload: unknown }[],
): Parecer[] {
  return eventos
    .filter(
      (e) =>
        e.type === 'artifact.qa_verdict' ||
        e.type === 'artifact.secops_verdict',
    )
    .map((e) => {
      const p = e.payload as {
        veredito?: string;
        resumo?: string;
        itens?: string[];
      };
      return {
        seq: e.seq,
        gate:
          e.type === 'artifact.qa_verdict'
            ? ('qa' as const)
            : ('secops' as const),
        veredito: p.veredito ?? '?',
        resumo: p.resumo ?? '',
        itens: p.itens ?? [],
      };
    });
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
      keycloakSub: `demo-gates-${sufixo}`,
      email: `demo-gates-${sufixo}@brabo.dev`,
    })
    .returning();
  const [workspace] = await db
    .insert(workspaces)
    .values({ name: 'demo', slug: `demo-gates-${sufixo}`, createdBy: user.id })
    .returning();
  const [project] = await db
    .insert(projects)
    .values({
      workspaceId: workspace.id,
      name: 'cobaia-pr-gates',
      slug: `cobaia-pr-gates-${sufixo}`,
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

  const modeloQa = await resolveModelo(MODELO_QA);
  await bindings.execute('agent', 'qa', modeloQa.id, user.id);
  log(`✓ modelo do agente qa: ${modeloQa.provider}/${modeloQa.name}`);

  await app.get(ProvisionRepositoryUseCase).execute(project.id, user.id, {
    provider: 'local',
    name: `cobaia-gates-${sufixo}`,
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
  log('✓ repo provisionado com esqueleto Node (npm test verde de saída)');

  // --- module_map + backlog com os dois defeitos plantados ---
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
    title: 'Integração com o parceiro',
  });

  const story = await stories.create({
    epicId: epic.id,
    projectId: project.id,
    sessionId: sessaoArq.id,
    title: 'Envio autenticado ao parceiro',
    description: 'Cliente de envio do módulo integracao.',
    rf: [RF_1, RF_2],
    rnf: ['Sem dependências externas.'],
    dod: ['npm test passa (exit 0)', 'função exportada em src/'],
    dor: ['comportamento descrito na task'],
  });
  await stories.updateModules(story.id, ['integracao']);
  await stories.updateStatus(story.id, 'ready');

  const task = await taskRepo.create({
    storyId: story.id,
    title: 'Implementar enviar(payload)',
    description: TASK_DESCRICAO,
  });
  log('✓ 1 story (2 RF) + 1 task com regra sem teste e segredo hardcoded');

  // --- Ativação: DevAgent real, teto de 3 correções por gate ---
  log('\n--- ativando a execução (DevAgent real, LLM local) ---');
  const { sessionId } = await app
    .get(ActivateExecutionUseCase)
    .execute(project.id, user.id, 5_000_000, 3, 'real');
  log(`✓ sessão: ${sessionId}`);

  // --- Acompanhamento ---
  const limite = Date.now() + Number(process.env.DEMO_TIMEOUT_MS ?? 1_800_000);
  let ultimoResumo = '';
  // A linha crua do banco, não a entidade de domínio: `gate_status` é `text`
  // no schema (typado só na borda TS), e aqui o que interessa é o valor que
  // está gravado, seja ele qual for.
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
    const quantos = pareceres(eventos.sort((a, b) => a.seq - b.seq)).length;

    const resumo = `${atual.status} gate=${atual.gateStatus ?? '-'} correções=${atual.gateCorrectionCount} pareceres=${quantos}${atual.blocked ? ' (BLOCKED)' : ''}`;
    if (resumo !== ultimoResumo) {
      log(`  ${resumo}`);
      ultimoResumo = resumo;
    }

    const terminou = atual.gateStatus === 'awaiting_user' || atual.blocked;
    if (terminou || Date.now() > limite) break;
    await new Promise((r) => setTimeout(r, 5_000));
  }

  // --- Resultado ---
  log('\n--- linha do tempo da PR ---');
  const eventos = (
    await db
      .select()
      .from(sessionEvents)
      .where(eq(sessionEvents.sessionId, sessionId))
  ).sort((a, b) => a.seq - b.seq);

  const obtidos = pareceres(eventos);
  log('dev → PR aberta');
  for (const p of obtidos) {
    log(`${p.gate} → ${p.veredito}: ${p.resumo}`);
    for (const item of p.itens) log(`     - ${item}`);
  }
  log(`você → gate atual: ${atual.gateStatus ?? '-'}`);

  const [pr] = await db
    .select()
    .from(proposedActions)
    .where(
      and(
        eq(proposedActions.projectId, project.id),
        eq(proposedActions.actionType, 'pr_open'),
      ),
    );
  if (pr) {
    const r = pr.executionResult as Record<string, unknown> | null;
    log(`\nPR: ${String(r?.pullRequestUrl ?? '-')} (status=${pr.status})`);
  }

  const custo = new Map<string, number>();
  for (const e of eventos) {
    if (e.type === 'agent.response') {
      const p = e.payload as { tokensSpentMicros?: number };
      custo.set(e.actorId, p.tokensSpentMicros ?? 0);
    }
  }
  log('\ncusto por agente (acumulado do último ciclo de cada um):');
  for (const [agente, micros] of custo) {
    log(`  ${agente}: US$ ${(micros / 1_000_000).toFixed(4)}`);
  }

  // --- Critério de aceite ---
  log('\n--- critério de aceite ---');
  const falhas: string[] = [];

  if (atual.blocked) {
    falhas.push(`task bloqueada: ${atual.blockedReason ?? '(sem motivo)'}`);
  }
  if (atual.gateStatus !== 'awaiting_user') {
    falhas.push(
      `gate final é "${atual.gateStatus ?? '-'}", esperado "awaiting_user"`,
    );
  }
  if (obtidos.length !== ESPERADO.length) {
    falhas.push(`${obtidos.length} parecer(es), esperado ${ESPERADO.length}`);
  }
  ESPERADO.forEach((esperado, i) => {
    const obtido = obtidos[i];
    if (!obtido) return;
    if (
      obtido.gate !== esperado.gate ||
      obtido.veredito !== esperado.veredito
    ) {
      falhas.push(
        `parecer ${i + 1}: ${obtido.gate}/${obtido.veredito}, esperado ${esperado.gate}/${esperado.veredito}`,
      );
    }
  });

  await app.close();

  if (falhas.length > 0) {
    log('✗ NÃO fechou:');
    for (const f of falhas) log(`  - ${f}`);
    log(`\nProjeto pra inspeção: ${project.id}`);
    process.exit(1);
  }

  log('✓ 4 pareceres na ordem dev → qa → secops → você, PR em awaiting_user');
  log(`\nO merge é manual: revise a PR e mergeie você. Projeto: ${project.id}`);
}

main().catch((error) => {
  console.error('\nDemo falhou:', error);
  process.exit(1);
});
