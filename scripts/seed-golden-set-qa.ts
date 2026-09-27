/**
 * Seed-only do golden-set de regressão do julgamento SEMÂNTICO do QA de
 * Automação (docs/adr/0123-golden-set-regressao-qa-automacao.md).
 *
 * Diferente de `demo-pr-gates.ts`/`demo-pr-gates-area-qa.ts`, este script NÃO
 * roda o gate — não chama `ActivateExecutionUseCase`, não sobe DevAgent
 * nenhum. Ele só PROVISIONA o que `Engine.Gates.QaAutomacaoAgent.run/5`
 * precisa pra rodar isolado, do jeito que `qa_automacao_agent_test.exs` já
 * chama a função hoje (com `dev_state`/`dev_context` sintéticos) — a
 * diferença é que aqui o cliente LLM é o REAL (`EngineApiClient.Live`), então
 * os dados por trás dele (projeto, sessão, binding de modelo, permissions.json)
 * têm que ser reais também.
 *
 * Uso: pnpm --filter api golden-set:qa-seed
 * (chamado por `apps/engine/test/engine/gates/qa_automacao_agent_golden_test.exs`,
 * via `System.cmd`, não à mão — mas roda solto também, pra depuração.)
 *
 * PRÉ-REQUISITOS: api e engine rodando de verdade e alcançáveis (a api
 * responde `propose_action`/`append_event`/`llm-turn`; o ENGINE decide onde o
 * `terminal` roda, via `/internal/actions/execute`), Ollama local respondendo
 * e — desde a AT-076 — o BROKER de container de pé: `BROKER_URL` na api,
 * `PROJECT_WORKSPACES_HOST_ROOT` no broker apontando para a MESMA pasta que
 * `PROJECT_WORKSPACES_ROOT` da api e do engine, e a imagem
 * `IMAGEM_DO_GOLDEN_SET_QA` já presente no daemon (a chamada api → broker tem
 * teto de 5s, e um `docker run` que precise PUXAR a imagem passa disso).
 *
 * ## O container de cada caso (AT-076, RN-502)
 *
 * Desde a RN-502 (ADR 0143) o engine RECUSA todo comando de terminal de um
 * projeto `container` sem container `running` REGISTRADO. Este seed nasceu
 * antes da regra e nunca subia container, então o `npm test` do QA era
 * recusado e o golden-set media 0/6 por construção (AT-067). Agora cada caso
 * sobe o container de verdade, pelo caminho de produção — module_map,
 * roteamento do Arquiteto, `container_start` proposto pela Infra e aprovado
 * pelo dono —, e o `npm test` roda DENTRO dele, pelo broker (ADR 0134,
 * RN-492). A recusa da RN-502 fica intacta; quem mudou foi o seed, que passou
 * a satisfazer a pré-condição dela. Se o container não sobe, o seed LANÇA um
 * erro nomeado com a etapa e o motivo, em vez de deixar o QA rodar contra a
 * recusa. O porquê de cada escolha está em `golden-set-qa-container.ts`.
 *
 * ## Por que este script faz o PRÓPRIO checkout, em vez de reusar
 * `Engine.Actions.Workspace`/`Engine.Dev.WorktreeManager`
 *
 * O golden test usa `Engine.DataCase` (banco `engine_test`, isolado) pela
 * mesma razão que `qa_automacao_agent_test.exs` usa — é o padrão do arquivo
 * que ele estende. Só que ESTE script grava projeto/sessão/repositório na
 * base de DEV (`DATABASE_URL`, a mesma que a api rodando de verdade usa) —
 * são bancos DIFERENTES. `ProjectRepository`/`WorktreeManager` do engine leem
 * de `Engine.Repo`, que no golden test aponta pro `engine_test` — não
 * enxergariam as linhas que este script grava. Por isso o worktree é
 * materializado AQUI (clone raso do bare repo já commitado, com `git
 * checkout` do branch default) e o CAMINHO viaja pronto no JSON de saída —
 * o teste Elixir só usa o caminho, nunca consulta o Postgres pra achá-lo.
 *
 * O caminho é a RAIZ gerenciada do projeto (`projectScopeRoot`), e isso é o
 * que faz os três lados verem o MESMO código: o broker monta
 * `<PROJECT_WORKSPACES_HOST_ROOT>/<workspace_dir_name>` em `/work`, e o
 * engine traduz o `cwd` do QA (esta pasta) para `/work` antes de mandar o
 * `exec` (`cwd_para_container/2` em `terminal_executor.ex`). Um clone fora
 * dela faria o `npm test` rodar num `/work` vazio.
 *
 * NÃO faz limpeza — mesma postura de `demo-pr-gates.ts` (sufixo por
 * timestamp, nunca apagado).
 */
import 'reflect-metadata';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
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
  models,
} from '../src/db/schema';
import { ProvisionRepositoryUseCase } from '../src/application/use-cases/git/provision-repository.use-case';
import { SetModelBindingUseCase } from '../src/application/use-cases/llm/set-model-binding.use-case';
import { SetModelsActiveUseCase } from '../src/application/use-cases/llm/set-models-active.use-case';
import { CreateSessionUseCase } from '../src/application/use-cases/sessions/create-session.use-case';
import { TransitionSessionUseCase } from '../src/application/use-cases/sessions/transition-session.use-case';
import { SeedAgentAreasUseCase } from '../src/application/use-cases/agents/seed-agent-areas.use-case';
import { CreateModuleMapUseCase } from '../src/application/use-cases/architecture/create-module-map.use-case';
import { RouteModulesToInfraUseCase } from '../src/application/use-cases/architecture/route-modules-to-infra.use-case';
import { ProposeActionUseCase } from '../src/application/use-cases/actions/propose-action.use-case';
import { ApproveActionUseCase } from '../src/application/use-cases/actions/approve-action.use-case';
import { ObterCicloDeVidaDoContainerUseCase } from '../src/application/use-cases/containers/obter-ciclo-de-vida-do-container.use-case';
import { ProvisionedRepositoryRepository } from '../src/application/ports/provisioned-repository-repository.port';
import { GitProviderRegistry } from '../src/application/ports/git-provider.port';
import { PermissionsFileStore } from '../src/application/ports/permissions-file-store.port';
import { ProjectRepository } from '../src/application/ports/project-repository.port';
import { DEV_TERMINAL_ALLOW_PATTERNS } from '../src/domain/actions/dev-terminal-patterns';
import { chaveDeAgente } from '../src/domain/llm/binding-scope-id';
import {
  workspaceDirNameFor,
  projectScopeRoot,
} from '../src/infrastructure/filesystem/project-workspaces-root';
import {
  IMAGEM_DO_GOLDEN_SET_QA,
  subirContainerDoCaso,
  type DependenciasDaSubida,
} from './golden-set-qa-container';

const execFileAsync = promisify(execFile);

// O modelo local do golden-set — sem credencial, é provider `ollama`. Nunca
// o mesmo default de `demo-pr-gates.ts` (`qwen2.5-coder:7b`, sem o `:latest`
// e mais leve): o golden-set mira nos dois modelos já puxados nesta máquina
// (ver ADR 0123), e o script CRIA a linha de `models` se ela não existir
// ainda — os demos antigos recusam (`resolveModelo` lança) porque esperam
// que `pnpm --filter api seed` já tenha semeado o catálogo fixo deles.
const MODELO_QA = process.env.GOLDEN_SET_QA_MODEL ?? 'qwen2.5-coder:latest';

function log(msg: string) {
  console.error(msg); // stderr: o stdout é só o JSON de saída (ver main()).
}

// --- os seis casos ---------------------------------------------------

interface Caso {
  id: string;
  /** Texto da(s) regra(s) que viram `story.rf` no dev_context do Elixir. */
  rf: string[];
  files: { path: string; content: string }[];
  expectedVerdict: 'approved' | 'changes_requested';
  taskTitle: string;
}

const PACKAGE_JSON = JSON.stringify(
  { name: 'cobaia-golden-qa', version: '1.0.0', private: true, scripts: { test: 'node --test' } },
  null,
  2,
);

const AGENTS_MD = `# Convenções deste repositório

- Node.js puro, SEM dependências externas. NUNCA rode \`npm install\`.
- Testes em \`test/\`, arquivos \`*.test.js\`, com o runner nativo do Node
  (\`node:test\`).
- Rode a suite com exatamente: \`npm test\`.
`;

const SMOKE_TEST = `const test = require('node:test');
const assert = require('node:assert');

test('a suite roda', () => {
  assert.strictEqual(1 + 1, 2);
});
`;

// Casos 1 e 2 — RF_1/RF_2 verbatim de demo-pr-gates.ts. O ESQUELETO é o
// MESMO nos dois casos (RF_1 testada, RF_2 não) — o que muda é qual regra
// entra em `story.rf`, isolando exatamente o julgamento que cada uma pede.
const RF_1_DEMO_PR_GATES = 'enviar(payload) devolve { payload, enviado: true }';
const RF_2_DEMO_PR_GATES = 'enviar(payload) lança Error quando o payload é vazio ou nulo';

const ESQUELETO_1_2 = [
  { path: 'package.json', content: PACKAGE_JSON },
  { path: 'AGENTS.md', content: AGENTS_MD },
  { path: 'test/smoke.test.js', content: SMOKE_TEST },
  {
    path: 'src/cliente.js',
    content: `function enviar(payload) {
  return { payload, enviado: true };
}

module.exports = { enviar };
`,
  },
  // Só a Regra 1 tem teste — a Regra 2 fica explicitamente descoberta,
  // exatamente como o esqueleto original de demo-pr-gates.ts planta.
  {
    path: 'test/cliente.test.js',
    content: `const test = require('node:test');
const assert = require('node:assert');
const { enviar } = require('../src/cliente');

test('enviar(payload) devolve { payload, enviado: true }', () => {
  assert.deepStrictEqual(enviar({ a: 1 }), { payload: { a: 1 }, enviado: true });
});
`,
  },
];

// Caso 3 — RF_1 de demo-pr-gates-area-qa.ts (regra única, coberta, aprovação
// limpa).
const RF_1_AREA_QA =
  'buscar(termo, produtos) devolve os produtos cujo nome contém o termo';

const ESQUELETO_3 = [
  { path: 'package.json', content: PACKAGE_JSON },
  { path: 'AGENTS.md', content: AGENTS_MD },
  { path: 'test/smoke.test.js', content: SMOKE_TEST },
  {
    path: 'src/busca.js',
    content: `function buscar(termo, produtos) {
  const alvo = termo.toLowerCase();
  return produtos.filter((p) => p.nome.toLowerCase().includes(alvo));
}

module.exports = { buscar };
`,
  },
  {
    path: 'test/busca.test.js',
    content: `const test = require('node:test');
const assert = require('node:assert');
const { buscar } = require('../src/busca');

test('buscar(termo, produtos) filtra por substring, sem diferenciar caixa', () => {
  const produtos = [{ nome: 'Caneta Azul' }, { nome: 'Lápis' }];
  assert.deepStrictEqual(buscar('caneta', produtos), [{ nome: 'Caneta Azul' }]);
});
`,
  },
];

// Caso 4 — regra coberta por um teste em arquivo com nome QUE NÃO CASA com a
// convenção (a regra é sobre `enviar()`, o teste mora em
// `outro-modulo.test.js`). Mede se o QA lê CONTEÚDO, não se pareia por nome
// de arquivo.
const RF_NOME_TROCADO = 'enviar(pedido) marca pedido.enviadoEm com a data atual';

const ESQUELETO_4 = [
  { path: 'package.json', content: PACKAGE_JSON },
  { path: 'AGENTS.md', content: AGENTS_MD },
  { path: 'test/smoke.test.js', content: SMOKE_TEST },
  {
    path: 'src/emissor.js',
    content: `function enviar(pedido) {
  return { ...pedido, enviadoEm: new Date().toISOString() };
}

module.exports = { enviar };
`,
  },
  // Nome DELIBERADAMENTE desalinhado com src/emissor.js — cobre a regra de
  // verdade, só que num arquivo cujo nome não dá nenhuma pista.
  {
    path: 'test/outro-modulo.test.js',
    content: `const test = require('node:test');
const assert = require('node:assert');
const { enviar } = require('../src/emissor');

test('enviar(pedido) marca enviadoEm com a data atual', () => {
  const resultado = enviar({ id: 1 });
  assert.ok(typeof resultado.enviadoEm === 'string' && resultado.enviadoEm.length > 0);
});
`,
  },
];

// Caso 5 — cobertura PARCIAL: a regra nomeia caminho feliz E caso de falha
// explícito; só o feliz tem teste. Mede se o QA carimba parcial como
// completo.
const RF_PARCIAL =
  'cancelar(pedido) marca pedido.status como "cancelado"; lança Error quando pedido.status já é "entregue"';

const ESQUELETO_5 = [
  { path: 'package.json', content: PACKAGE_JSON },
  { path: 'AGENTS.md', content: AGENTS_MD },
  { path: 'test/smoke.test.js', content: SMOKE_TEST },
  {
    path: 'src/pedido.js',
    content: `function cancelar(pedido) {
  if (pedido.status === 'entregue') {
    throw new Error('pedido já entregue');
  }
  return { ...pedido, status: 'cancelado' };
}

module.exports = { cancelar };
`,
  },
  // Só o caminho feliz — a exceção do pedido já entregue NUNCA é exercitada.
  {
    path: 'test/pedido.test.js',
    content: `const test = require('node:test');
const assert = require('node:assert');
const { cancelar } = require('../src/pedido');

test('cancelar(pedido) marca status como cancelado', () => {
  assert.deepStrictEqual(cancelar({ status: 'pendente' }), { status: 'cancelado' });
});
`,
  },
];

// Caso 6 — o único teste "cobrindo" a regra está PULADO (`test.skip`). Mede
// se o QA conta teste desabilitado como cobertura.
const RF_TESTE_PULADO = 'arquivar(nota) marca nota.arquivada como true';

const ESQUELETO_6 = [
  { path: 'package.json', content: PACKAGE_JSON },
  { path: 'AGENTS.md', content: AGENTS_MD },
  { path: 'test/smoke.test.js', content: SMOKE_TEST },
  {
    path: 'src/nota.js',
    content: `function arquivar(nota) {
  return { ...nota, arquivada: true };
}

module.exports = { arquivar };
`,
  },
  {
    path: 'test/nota.test.js',
    content: `const test = require('node:test');
const assert = require('node:assert');
const { arquivar } = require('../src/nota');

test.skip('arquivar(nota) marca arquivada como true', () => {
  assert.deepStrictEqual(arquivar({ id: 1 }), { id: 1, arquivada: true });
});
`,
  },
];

const CASOS: Caso[] = [
  {
    id: 'rf-covered',
    rf: [RF_1_DEMO_PR_GATES],
    files: ESQUELETO_1_2,
    expectedVerdict: 'approved',
    taskTitle: 'Regra coberta (RF_1 de demo-pr-gates.ts)',
  },
  {
    id: 'rf-uncovered',
    rf: [RF_2_DEMO_PR_GATES],
    files: ESQUELETO_1_2,
    expectedVerdict: 'changes_requested',
    taskTitle: 'Regra sem teste (RF_2 de demo-pr-gates.ts)',
  },
  {
    id: 'rf-single-clean',
    rf: [RF_1_AREA_QA],
    files: ESQUELETO_3,
    expectedVerdict: 'approved',
    taskTitle: 'Regra única coberta, aprovação limpa (demo-pr-gates-area-qa.ts)',
  },
  {
    id: 'rf-mismatched-filename',
    rf: [RF_NOME_TROCADO],
    files: ESQUELETO_4,
    expectedVerdict: 'approved',
    taskTitle: 'Regra coberta por teste em arquivo com nome trocado',
  },
  {
    id: 'rf-partial-coverage',
    rf: [RF_PARCIAL],
    files: ESQUELETO_5,
    expectedVerdict: 'changes_requested',
    taskTitle: 'Regra com cobertura parcial (falta o caso de falha)',
  },
  {
    id: 'rf-skipped-test',
    rf: [RF_TESTE_PULADO],
    files: ESQUELETO_6,
    expectedVerdict: 'changes_requested',
    taskTitle: 'Único teste cobrindo a regra está pulado (test.skip)',
  },
];

// --- checkout raso do bare repo, ver o comentário do topo do arquivo -----

async function materializeWorktree(bareRepoPath: string, dest: string, branch: string) {
  await mkdir(dest, { recursive: true });
  await execFileAsync('git', ['clone', '--branch', branch, bareRepoPath, dest]);
  return dest;
}

// --- main ------------------------------------------------------------

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error'],
  });
  const db = app.get<DrizzleDb>(DRIZZLE);
  const repos = app.get(ProvisionedRepositoryRepository);
  const registry = app.get(GitProviderRegistry);
  const permissionsFile = app.get(PermissionsFileStore);
  const projectsPort = app.get(ProjectRepository);
  const bindings = app.get(SetModelBindingUseCase);
  const setModelsActive = app.get(SetModelsActiveUseCase);
  const createSession = app.get(CreateSessionUseCase);
  const transitionSession = app.get(TransitionSessionUseCase);
  const seedAreas = app.get(SeedAgentAreasUseCase);
  const subida: DependenciasDaSubida = {
    createSession,
    transitionSession,
    createModuleMap: app.get(CreateModuleMapUseCase),
    routeModulesToInfra: app.get(RouteModulesToInfraUseCase),
    proposeAction: app.get(ProposeActionUseCase),
    approveAction: app.get(ApproveActionUseCase),
    obterCicloDeVida: app.get(ObterCicloDeVidaDoContainerUseCase),
  };

  const sufixo = Date.now();

  const [user] = await db
    .insert(users)
    .values({
      keycloakSub: `golden-qa-${sufixo}`,
      email: `golden-qa-${sufixo}@brabo.dev`,
    })
    .returning();
  const [workspace] = await db
    .insert(workspaces)
    .values({ name: 'golden-qa', slug: `golden-qa-${sufixo}`, createdBy: user.id })
    .returning();
  log(`✓ workspace: ${workspace.id}`);

  // Resolve OU CRIA a linha de `models` — diferente dos demos antigos, que
  // exigem `pnpm --filter api seed` ter semeado o catálogo fixo antes. O
  // golden-set mira em modelos Ollama arbitrários (ver GOLDEN_SET_QA_MODEL),
  // e travar num catálogo fixo obrigaria editar seed.ts a cada modelo novo.
  async function resolveOuCriaModelo(nome: string) {
    const [existente] = await db
      .select()
      .from(models)
      .where(and(eq(models.provider, 'ollama'), eq(models.name, nome)));
    if (existente) return existente;

    const [criado] = await db
      .insert(models)
      .values({
        provider: 'ollama',
        name: nome,
        displayName: `${nome} (local, golden-set)`,
        inputPricePerMillionMicros: 0,
        outputPricePerMillionMicros: 0,
        // O golden-set MEDE justamente isto — mas o binding de escopo
        // `agent` recusa modelo sem tool calling declarado (Fase 9a), então
        // a declaração aqui é a aposta mínima pra sequer rodar o ToolLoop.
        // Se o modelo não chamar ferramenta nenhuma de verdade, o próprio
        // caso vira `changes_requested`/bloqueio — não um erro de seed.
        supportsToolCalling: true,
      })
      .returning();
    return criado;
  }

  const modeloQa = await resolveOuCriaModelo(MODELO_QA);
  log(`✓ modelo: ${modeloQa.provider}/${modeloQa.name}`);

  // Curadoria do workspace (RN-043/ADR 0049) — sem isto o binding de escopo
  // `agent` recusa com "inativo": ausência de linha em `workspace_models` é
  // o desligado.
  await setModelsActive.execute({
    workspaceId: workspace.id,
    modelIds: [modeloQa.id],
    isActive: true,
    curatedBy: user.id,
  });

  const casosSaida: unknown[] = [];

  for (const caso of CASOS) {
    // Raw insert, como os demos — mas `workspace_dir_name` (RN-109) é
    // NOT NULL/UNIQUE desde que passou a existir: `CreateProjectUseCase` é
    // quem normalmente gera o id ANTES do insert pra poder derivá-lo. Os
    // dois demos mais antigos não fazem isso (não passam mais no typecheck
    // do ts-node contra o schema de hoje) — aqui replicamos o caminho real.
    const projectId = randomUUID();
    const slug = `golden-qa-${caso.id}-${sufixo}`;
    const [project] = await db
      .insert(projects)
      .values({
        id: projectId,
        workspaceId: workspace.id,
        name: `golden-qa-${caso.id}`,
        slug,
        createdBy: user.id,
        workspaceDirName: workspaceDirNameFor(projectId, slug),
      })
      .returning();
    await db
      .insert(projectMembers)
      .values({ projectId: project.id, userId: user.id, role: 'owner' });

    // Sem isto, `agent_areas` fica vazia para o projeto (RN-094: a tabela
    // nasce COM o projeto, mas só quando `CreateProjectUseCase` a semeia — o
    // insert cru acima pula esse caminho) e `RecordLlmUsageUseCase` recusa
    // com 404 ("Área \"qa\" não existe neste projeto") no PRIMEIRO turno de
    // LLM do QA de Automação: `token_usage`/`agent_areas.spent_micros` são
    // metering OBRIGATÓRIO (RN-036), nunca best-effort.
    await seedAreas.execute(project.id);

    // 'qa-automacao', NUNCA 'qa' — desde a Fase 8b quem roda de verdade é o
    // subagente, e vincular em 'qa' seria no-op (ver demo-pr-gates-area-qa.ts:281).
    await bindings.execute(
      'agent',
      chaveDeAgente(project.id, 'qa-automacao'),
      modeloQa.id,
      user.id,
    );

    await app.get(ProvisionRepositoryUseCase).execute(project.id, user.id, {
      provider: 'local',
      name: `golden-qa-${caso.id}-${sufixo}`,
      visibility: 'private',
    });
    const repo = await repos.findByProjectId(project.id);
    if (!repo) throw new Error(`repo não provisionado para o caso ${caso.id}`);

    await registry.get('local').commitFiles({
      externalId: repo.externalId,
      branch: repo.defaultBranch,
      message: `chore: esqueleto do golden-set (${caso.id})`,
      files: caso.files,
      accessToken: '',
    });

    const projectRow = await projectsPort.findById(project.id);
    if (!projectRow) throw new Error(`projeto ${project.id} sumiu depois de criado`);

    // O worktree materializa DENTRO de `projectScopeRoot(project)` — não num
    // scratch dir qualquer. O TETO DO ESCOPO DE CAMINHO (ADR 0055,
    // decide.ts) recusa auto-aprovar QUALQUER `terminal` cujo `cwd` caia
    // fora da raiz do projeto, mesmo com o comando batendo num allow —
    // um scratch dir separado faria todo `npm test` nascer `pending` para
    // sempre, e o QA nunca veria um `terminal` com exit 0. O `git clone`
    // tem que rodar ANTES de `addPattern` gravar `permissions.json`: clonar
    // exige diretório vazio, e o arquivo de permissões nasceria primeiro se
    // a ordem fosse invertida.
    const worktreePath = await materializeWorktree(
      repo.externalId,
      projectScopeRoot({
        executionMode: projectRow.executionMode,
        workspaceDirName: projectRow.workspaceDirName,
        workspacePath: projectRow.workspacePath,
      }),
      repo.defaultBranch,
    );

    // Mesmos padrões que `ActivateExecutionUseCase` libera pro dev — sem
    // isto `npm test` nasce `pending` (decide() default é require_approval)
    // e o QA nunca vê um `terminal` com exit 0 no histórico.
    for (const pattern of DEV_TERMINAL_ALLOW_PATTERNS) {
      await permissionsFile.addPattern(projectRow, 'allow', pattern);
    }

    // O container de VERDADE, pelo caminho de produção (AT-076, RN-502) —
    // DEPOIS do clone e do `permissions.json`: o bind-mount do broker monta
    // esta mesma pasta em `/work`, e se o daemon chegasse antes ele a criaria
    // vazia, como `root`. Ver `golden-set-qa-container.ts`.
    const container = await subirContainerDoCaso(subida, {
      casoId: caso.id,
      projectId: project.id,
      userId: user.id,
    });
    log(
      `✓ caso ${caso.id}: container ${container.containerId.slice(0, 12)} running ` +
        `(container_start ${container.actionId}, sessão de infra ${container.infraSessionId})`,
    );

    const session = await createSession.execute(project.id, user.id, {
      kind: 'criativa',
    });
    await transitionSession.execute(project.id, session.id, 'active');

    casosSaida.push({
      id: caso.id,
      projectId: project.id,
      sessionId: session.id,
      worktreePath,
      containerId: container.containerId,
      infraSessionId: container.infraSessionId,
      story: { id: `st-${caso.id}`, title: caso.taskTitle, rf: caso.rf, rnf: [] },
      task: {
        id: `task-${caso.id}`,
        title: caso.taskTitle,
        description: caso.rf.join('\n'),
      },
      expectedVerdict: caso.expectedVerdict,
    });
    log(`✓ caso ${caso.id}: projeto ${project.id}, worktree ${worktreePath}`);
  }

  await app.close();

  // ÚNICA coisa no stdout — o teste Elixir faz `Jason.decode!` direto nele.
  process.stdout.write(
    JSON.stringify({
      model: MODELO_QA,
      image: IMAGEM_DO_GOLDEN_SET_QA,
      cases: casosSaida,
    }),
  );
}

main().catch((error) => {
  console.error('\nSeed do golden-set falhou:', error);
  process.exit(1);
});
