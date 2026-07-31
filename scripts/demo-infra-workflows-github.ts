/**
 * Demo do critério de aceite da ÁREA DE INFRA (Fase 8c, ADR 0038, segunda
 * instância do modelo do ADR 0038 depois da área de QA — Fase 8b): no
 * projeto-cobaia com `GithubProvider`, o handoff de infra resulta numa PR
 * CONSOLIDADA contendo Dockerfile + workflow de CI válido (actionlint
 * verde), narrada no feed com a delegação visível.
 *
 * Uso: pnpm --filter api demo:infra-workflows-github
 *
 * PRÉ-REQUISITOS: os mesmos de `demo-infra-agent.ts` (stack de pé, modelo
 * Ollama seedado, execução de dentro do container da api, hadolint/yamllint/
 * actionlint reais na imagem do engine). NÃO precisa de GITHUB_TEST_TOKEN
 * nem de rede real pro GitHub — ver a seção abaixo.
 *
 * NÃO É DETERMINÍSTICO com modelo local: o Lead e o Workflows geram os
 * arquivos via LLM. O que se exige é que a PR exista com Dockerfile E
 * workflow, que os dois tenham passado por `validate_infra_file`, e que as
 * DUAS delegações fiquem registradas — não que o modelo escreva um YAML
 * específico. Rode deliberadamente, não em CI.
 *
 * ## Por que GithubProvider aqui é hermético
 *
 * `ProvisionRepositoryUseCase` chama a API REAL do GitHub pra qualquer
 * provider que não seja `local` — inclusive pra só CRIAR o repositório. Em
 * vez de depender de uma conta de teste e um PAT vivo (o que o smoke test
 * manual do `GithubProvider`, `github-provider.smoke.spec.ts`, já cobre
 * separadamente e nunca roda em CI), este demo intercepta `api.github.com`
 * com a MESMA suite de mock usada nos testes de contrato
 * (`test/support/msw/github-fake-backend.ts` + `FakeRepoStore`) — o
 * `GithubProvider` de produção roda de verdade, só o transporte HTTP é
 * fake. O que NÃO é fake é o resto: o Lead/Workflows geram os arquivos via
 * LLM de verdade, os gates de infra rodam hadolint/yamllint de verdade, e
 * `ValidateInfraFile` roda actionlint de verdade (se presente na imagem).
 *
 * A credencial de GitHub também precisa existir (o use-case recusa
 * provisionar sem ela) — seedada aqui via `EncryptionService` real, mesmo
 * padrão de `handle-git-oauth-callback.use-case.spec.ts`. O valor do token
 * não importa: os handlers mockados não validam o cabeçalho Authorization.
 */
import 'reflect-metadata';
import { setupServer } from 'msw/node';
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
  userCredentials,
} from '../src/db/schema';
import { ProvisionRepositoryUseCase } from '../src/application/use-cases/git/provision-repository.use-case';
import { SetModelBindingUseCase } from '../src/application/use-cases/llm/set-model-binding.use-case';
import { CreateHandoffUseCase } from '../src/application/use-cases/agents/create-handoff.use-case';
import { AcceptHandoffUseCase } from '../src/application/use-cases/agents/accept-handoff.use-case';
import { TransitionSessionUseCase } from '../src/application/use-cases/sessions/transition-session.use-case';
import { ProposeActionUseCase } from '../src/application/use-cases/actions/propose-action.use-case';
import { SessionRepository } from '../src/application/ports/session-repository.port';
import { ModuleMapRepository } from '../src/application/ports/module-map-repository.port';
import { ProvisionedRepositoryRepository } from '../src/application/ports/provisioned-repository-repository.port';
import { EncryptionService } from '../src/application/ports/encryption.port';
import { FakeRepoStore } from '../test/support/msw/fake-repo-store';
import { createGithubHandlers } from '../test/support/msw/github-fake-backend';

const MODELO = process.env.DEMO_MODEL ?? 'qwen2.5-coder:7b';
const MODELO_WORKFLOWS = process.env.DEMO_WORKFLOWS_MODEL ?? MODELO;

const MODULOS = [
  {
    name: 'api',
    stack: 'Node.js',
    responsibility: 'API HTTP do produto',
    dependsOn: [],
  },
];

const ADR_INFRA = {
  title: 'ADR 0001 — Containers por módulo e CI por PR',
  content: [
    'Cada módulo do module_map tem seu próprio Dockerfile. O pipeline de CI',
    'roda lint/testes/build em toda PR pras branches permanentes.',
  ].join('\n'),
  infraRelevant: true,
};

function log(msg: string) {
  console.log(msg);
}

interface Delegacao {
  seq: number;
  tipo: string;
  subagent: string;
}

function delegacoes(
  eventos: { seq: number; type: string; payload: unknown }[],
): Delegacao[] {
  return eventos
    .filter((e) => e.type.startsWith('delegation.'))
    .map((e) => ({
      seq: e.seq,
      tipo: e.type.replace('delegation.', ''),
      subagent: (e.payload as { subagent?: string }).subagent ?? '?',
    }));
}

async function main() {
  const store = new FakeRepoStore();
  const server = setupServer(...createGithubHandlers(store));
  server.listen({ onUnhandledRequest: 'bypass' });

  try {
    await run();
  } finally {
    server.close();
  }
}

async function run() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error'],
  });
  const db = app.get<DrizzleDb>(DRIZZLE);
  const sessions = app.get(SessionRepository);
  const moduleMaps = app.get(ModuleMapRepository);
  const repos = app.get(ProvisionedRepositoryRepository);
  const encryption = app.get(EncryptionService);

  const sufixo = Date.now();

  const [user] = await db
    .insert(users)
    .values({
      keycloakSub: `demo-infra-gh-${sufixo}`,
      email: `demo-infra-gh-${sufixo}@brabo.dev`,
    })
    .returning();
  const [workspace] = await db
    .insert(workspaces)
    .values({
      name: 'demo',
      slug: `demo-infra-gh-${sufixo}`,
      createdBy: user.id,
    })
    .returning();
  const [project] = await db
    .insert(projects)
    .values({
      workspaceId: workspace.id,
      name: 'cobaia-infra-github',
      slug: `cobaia-infra-gh-${sufixo}`,
      createdBy: user.id,
    })
    .returning();
  await db
    .insert(projectMembers)
    .values({ projectId: project.id, userId: user.id, role: 'owner' });
  log(`✓ projeto-cobaia: ${project.id}`);

  // Credencial de GitHub fake — o token não é validado pelos handlers
  // mockados, só precisa existir pra ProvisionRepositoryUseCase decidir
  // provisionar (ver moduledoc acima).
  const secret = encryption.encrypt('fake-github-token');
  await db.insert(userCredentials).values({
    userId: user.id,
    provider: 'github',
    ...secret,
  });
  log('✓ credencial de GitHub (fake, transporte mockado por msw)');

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

  // O Workflows é uma subespecialidade nova (Fase 8c) — sem binding
  // próprio, cai pro binding de projeto, o que não erra nada, só não
  // exercita um modelo mais forte especificamente nela.
  const modeloWorkflows = await resolveModelo(MODELO_WORKFLOWS);
  await bindings.execute(
    'agent',
    'infra-workflows',
    modeloWorkflows.id,
    user.id,
  );
  log(`✓ modelo do Workflows: ${modeloWorkflows.provider}/${modeloWorkflows.name}`);

  await app.get(ProvisionRepositoryUseCase).execute(project.id, user.id, {
    provider: 'github',
    name: `cobaia-infra-gh-${sufixo}`,
    visibility: 'private',
  });
  const repo = await repos.findByProjectId(project.id);
  if (!repo) throw new Error('repo não provisionado');
  log(`✓ repo provisionado (mockado): ${repo.provider}/${repo.externalId}`);

  const session = await sessions.create({
    projectId: project.id,
    createdBy: user.id,
  });
  await app
    .get(TransitionSessionUseCase)
    .execute(project.id, session.id, 'active');

  await moduleMaps.create({
    projectId: project.id,
    sessionId: session.id,
    modules: MODULOS,
    version: 1,
  });

  await app.get(ProposeActionUseCase).execute(project.id, session.id, {
    actionType: 'open_adr_pr',
    actor: { kind: 'agent', id: 'arquiteto' },
    payload: ADR_INFRA,
  });
  log(`✓ module_map (${MODULOS.map((m) => m.name).join(', ')}) + ADR infraRelevant`);

  const handoff = await app
    .get(CreateHandoffUseCase)
    .execute(project.id, session.id, {
      fromAgent: 'arquiteto',
      toAgent: 'infra',
    });

  log('\n--- aceitando o handoff (ativa o Infra Lead) ---');
  await app
    .get(AcceptHandoffUseCase)
    .execute(project.id, session.id, handoff.id, user.id);
  log(`✓ sessão: ${session.id}`);

  const limite = Date.now() + Number(process.env.DEMO_TIMEOUT_MS ?? 1_800_000);
  let ultimoResumo = '';
  let prAction: typeof proposedActions.$inferSelect | undefined;

  for (;;) {
    [prAction] = await db
      .select()
      .from(proposedActions)
      .where(
        and(
          eq(proposedActions.projectId, project.id),
          eq(proposedActions.actionType, 'open_infra_pr'),
        ),
      );

    const eventos = await db
      .select()
      .from(sessionEvents)
      .where(eq(sessionEvents.sessionId, session.id));
    const delegs = delegacoes(eventos.sort((a, b) => a.seq - b.seq));

    const resumo = prAction
      ? `PR proposta (status=${prAction.status}), delegações=${delegs.length}`
      : `aguardando a PR de infra (delegações=${delegs.length})`;
    if (resumo !== ultimoResumo) {
      log(`  ${resumo}`);
      ultimoResumo = resumo;
    }

    const terminou = prAction && prAction.status !== 'pending';
    if (terminou || Date.now() > limite) break;
    await new Promise((r) => setTimeout(r, 5_000));
  }

  // --- Resultado ---
  const eventos = (
    await db
      .select()
      .from(sessionEvents)
      .where(eq(sessionEvents.sessionId, session.id))
  ).sort((a, b) => a.seq - b.seq);

  log('\n--- delegações da área de Infra (narradas no feed) ---');
  const obtidas = delegacoes(eventos);
  for (const d of obtidas) log(`  ${d.subagent} → ${d.tipo}`);

  const arquivos =
    (prAction?.payload as { files?: { path: string }[] } | undefined)
      ?.files ?? [];
  if (prAction) {
    const r = prAction.executionResult as Record<string, unknown> | null;
    log(
      `\nPR: ${String(r?.pullRequestUrl ?? '-')} (status=${prAction.status})`,
    );
    log(`arquivos: ${arquivos.map((f) => f.path).join(', ') || '(nenhum)'}`);
  }

  // O resultado do actionlint fica no `tool.result` do Workflows (a
  // VALIDAÇÃO acontece na geração, não num gate pós-PR — o gate pós-PR
  // segue usando yamllint genérico pra todo YAML, ver
  // docs/adr/0039-*.md).
  const resultadoActionlint = eventos.find(
    (e) =>
      e.type === 'tool.result' &&
      e.actorId === 'infra-workflows' &&
      (e.payload as { tool?: string }).tool === 'validate_infra_file' &&
      String((e.payload as { result?: string }).result).includes(
        'actionlint',
      ),
  );

  // --- Critério de aceite ---
  log('\n--- critério de aceite ---');
  const falhas: string[] = [];

  if (!prAction) {
    falhas.push('a área de Infra não chegou a propor uma PR');
  } else if (prAction.status !== 'executed') {
    falhas.push(`a PR de infra não foi executada (status=${prAction.status})`);
  }

  const temDockerfile = arquivos.some((f) =>
    f.path.toLowerCase().includes('dockerfile'),
  );
  if (!temDockerfile) falhas.push('a PR não tem nenhum Dockerfile');

  const temWorkflow = arquivos.some((f) =>
    f.path.startsWith('.github/workflows/'),
  );
  if (!temWorkflow) falhas.push('a PR não tem nenhum workflow de CI (.github/workflows/)');

  const infraLead = obtidas.filter((d) => d.subagent === 'infra-lead');
  const infraWorkflows = obtidas.filter((d) => d.subagent === 'infra-workflows');
  if (infraLead.length === 0) falhas.push('nenhuma delegação de infra-lead registrada');
  if (infraWorkflows.length === 0)
    falhas.push('nenhuma delegação de infra-workflows registrada');
  if (obtidas.some((d) => d.tipo === 'dispensed'))
    falhas.push('a área de Infra não dispensa delegado — nunca deveria haver dispensed aqui');

  if (!resultadoActionlint) {
    falhas.push(
      'nenhum tool.result de validate_infra_file mencionando actionlint — o Workflows não ' +
        'chegou a validar o workflow gerado (ou actionlint está ausente na imagem do engine)',
    );
  } else if (
    String((resultadoActionlint.payload as { result?: string }).result).includes(
      'indisponível',
    )
  ) {
    falhas.push('actionlint ausente no engine — o Workflows gerou o pipeline sem validar');
  }

  await app.close();

  if (falhas.length > 0) {
    log('✗ NÃO fechou:');
    for (const f of falhas) log(`  - ${f}`);
    log(`\nProjeto pra inspeção: ${project.id}`);
    process.exit(1);
  }

  log('✓ PR consolidada (Dockerfile + workflow de CI válido), duas delegações narradas no feed');
  log(`\nProjeto: ${project.id}`);
}

main().catch((error) => {
  console.error('\nDemo falhou:', error);
  process.exit(1);
});
