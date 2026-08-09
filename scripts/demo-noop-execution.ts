/**
 * Demo do critério de aceite da Fase 4a (infraestrutura dos dev agents),
 * exercitada com o NoopDevAgent — o agente burro, sem LLM.
 *
 * Uso: pnpm --filter api demo:noop-execution
 *
 * PRÉ-REQUISITOS: a stack de dev de pé (`docker compose -f docker/docker-compose.yml up`)
 * — api e engine precisam estar no ar E compartilhar o FS dos bare repos
 * (GIT_LOCAL_REPOS_ROOT) e dos workspaces (PROJECT_WORKSPACES_ROOT), que é
 * como o Compose já os monta. O script fala com o Postgres direto e sobe um
 * contexto Nest pra pegar os use-cases do container (sem HTTP/auth).
 *
 * O que ele demonstra, em ordem:
 *   1. ativa a execução num projeto com module_map de 2 módulos, em modo noop;
 *   2. 2 NoopDevAgents pegam suas tasks e abrem PRs EM PARALELO, cada um no
 *      seu worktree, com commit assinado `dev-<modulo>[bot]` + co-author;
 *   3. aceita a sugestão de paralelização e vê o 3º agente (`dev-api-2`)
 *      trabalhando no mesmo módulo, com worktree próprio;
 *   4. tenta auto-aprovar um merge em `dev` com agent_autonomy=auto_approve E
 *      permissions.json liberando — e mostra a trava rejeitando (pending).
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
} from '../src/db/schema';
import { ProvisionRepositoryUseCase } from '../src/application/use-cases/git/provision-repository.use-case';
import { ActivateExecutionUseCase } from '../src/application/use-cases/execution/activate-execution.use-case';
import { AcceptParallelizationUseCase } from '../src/application/use-cases/execution/accept-parallelization.use-case';
import { ProposeActionUseCase } from '../src/application/use-cases/actions/propose-action.use-case';
import { SessionRepository } from '../src/application/ports/session-repository.port';
import { ModuleMapRepository } from '../src/application/ports/module-map-repository.port';
import {
  EpicRepository,
  StoryRepository,
  TaskRepository,
} from '../src/application/ports/backlog-repository.port';
import { AgentAutonomyRepository } from '../src/application/ports/agent-autonomy-repository.port';
import { PermissionsFileStore } from '../src/application/ports/permissions-file-store.port';

const MODULOS = [
  {
    name: 'api',
    stack: 'NestJS',
    responsibility: 'regras de negócio e endpoints',
    dependsOn: [],
  },
  {
    name: 'web',
    stack: 'React',
    responsibility: 'interface do usuário',
    dependsOn: ['api'],
  },
];

function log(msg: string) {
  console.log(msg);
}

async function esperar<T>(
  rotulo: string,
  fn: () => Promise<T | null>,
  timeoutMs = 60_000,
): Promise<T> {
  const limite = Date.now() + timeoutMs;
  for (;;) {
    const valor = await fn();
    if (valor) return valor;
    if (Date.now() > limite) {
      throw new Error(`timeout esperando: ${rotulo}`);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
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
  const tasks = app.get(TaskRepository);
  const autonomy = app.get(AgentAutonomyRepository);
  const permissions = app.get(PermissionsFileStore);

  const sufixo = Date.now();

  // --- Projeto + repo local provisionado (Gitflow) ---
  const [user] = await db
    .insert(users)
    .values({
      keycloakSub: `demo-noop-${sufixo}`,
      email: `demo-noop-${sufixo}@brabo.dev`,
    })
    .returning();
  const [workspace] = await db
    .insert(workspaces)
    .values({ name: 'demo', slug: `demo-noop-${sufixo}`, createdBy: user.id })
    .returning();
  const [project] = await db
    .insert(projects)
    .values({
      workspaceId: workspace.id,
      name: 'demo-noop-execution',
      slug: `demo-noop-execution-${sufixo}`,
      createdBy: user.id,
    })
    .returning();
  // As ações git dos devs herdam o papel de quem ativou a execução na
  // avaliação de IAM (decide() resolve o papel de `session.createdBy`). Sem
  // esta linha TUDO nasce `denied` no primeiro estágio, e a demo não prova
  // nada sobre autonomia nem sobre a trava de merge.
  await db
    .insert(projectMembers)
    .values({ projectId: project.id, userId: user.id, role: 'owner' });
  log(`✓ projeto: ${project.id} (usuário como owner)`);

  await app.get(ProvisionRepositoryUseCase).execute(project.id, user.id, {
    provider: 'local',
    name: `demo-noop-${sufixo}`,
    visibility: 'private',
  });
  log('✓ repo local provisionado (dev/qa/rc/main)');

  // --- module_map de 2 módulos + backlog com ramos independentes ---
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
  log(`✓ module_map v1: ${MODULOS.map((m) => m.name).join(', ')}`);

  const epic = await epics.create({
    projectId: project.id,
    sessionId: sessaoArq.id,
    title: 'Cadastro de usuários',
  });

  // 3 tasks pegáveis em "api" (≥2 dispara a sugestão de paralelização) e 1 em "web".
  for (const [modulo, titulos] of [
    ['api', ['Endpoint de cadastro', 'Validação de e-mail', 'Listagem']],
    ['web', ['Formulário de cadastro']],
  ] as const) {
    const story = await stories.create({
      epicId: epic.id,
      projectId: project.id,
      sessionId: sessaoArq.id,
      title: `Cadastro — ${modulo}`,
      dod: ['testes passando'],
      dor: ['regra de negócio definida'],
    });
    await stories.updateModules(story.id, [modulo]);
    await stories.updateStatus(story.id, 'ready');
    for (const titulo of titulos) {
      await tasks.create({ storyId: story.id, title: titulo });
    }
  }
  log('✓ backlog: 3 tasks pegáveis em "api", 1 em "web"');

  // --- 1. Ativação da execução em modo NOOP ---
  log('\n--- 1. ativando a execução (devAgentImpl: noop) ---');
  const { sessionId } = await app
    .get(ActivateExecutionUseCase)
    .execute(project.id, user.id, undefined, undefined, 'noop');
  log(`✓ sessão de execução: ${sessionId}`);

  // --- 2. Os 2 NoopDevAgents abrem PRs em paralelo ---
  log('\n--- 2. dois NoopDevAgents em paralelo ---');
  const prs = await esperar('2 PRs abertas', async () => {
    const linhas = await db
      .select()
      .from(proposedActions)
      .where(
        and(
          eq(proposedActions.projectId, project.id),
          eq(proposedActions.actionType, 'pr_open'),
        ),
      );
    return linhas.length >= 2 ? linhas : null;
  });

  const branches = new Set<string>();
  for (const pr of prs) {
    const payload = pr.payload as Record<string, unknown>;
    branches.add(String(payload.sourceBranch));
    log(
      `✓ PR de ${pr.actorId}: branch=${String(payload.sourceBranch)} status=${pr.status}`,
    );
    if (pr.status === 'pending') {
      throw new Error(
        `PR de ${pr.actorId} ficou pendente — a autonomia auto_approve não foi seedada`,
      );
    }
    if (pr.status !== 'executed') {
      throw new Error(
        `PR de ${pr.actorId} não abriu (status=${pr.status}): ${JSON.stringify(pr.executionResult)}`,
      );
    }
  }
  if (branches.size !== prs.length) {
    throw new Error(
      'dois agentes abriram PR na MESMA branch — os worktrees não estão isolados',
    );
  }

  const commits = await db
    .select()
    .from(proposedActions)
    .where(
      and(
        eq(proposedActions.projectId, project.id),
        eq(proposedActions.actionType, 'git_commit'),
      ),
    );
  for (const c of commits) {
    const p = c.payload as Record<string, unknown>;
    log(
      `  commit de ${c.actorId}: author=${String(p.author)} co-author=${String(p.coAuthor)} status=${c.status}`,
    );
  }

  // --- 3. Aceite da sugestão de paralelização ---
  log('\n--- 3. sugestão de paralelização + aceite de um clique ---');
  const sugestao = await db
    .select()
    .from(sessionEvents)
    .where(
      and(
        eq(sessionEvents.sessionId, sessionId),
        eq(sessionEvents.type, 'execution.parallelization_suggested'),
      ),
    );
  if (sugestao.length === 0) {
    log('! nenhuma sugestão emitida (esperava ≥2 tasks pegáveis em "api")');
  } else {
    log(`✓ sugerido: ${JSON.stringify(sugestao[0].payload)}`);
    await app
      .get(AcceptParallelizationUseCase)
      .execute(project.id, sessionId, 'api', user.id);
    log('✓ aceite enviado — subindo dev-api-2');

    const extra = await esperar('PR do terceiro agente', async () => {
      const [linha] = await db
        .select()
        .from(proposedActions)
        .where(
          and(
            eq(proposedActions.projectId, project.id),
            eq(proposedActions.actorId, 'dev-api-2'),
            eq(proposedActions.actionType, 'pr_open'),
          ),
        );
      return linha ?? null;
    });
    const p = extra.payload as Record<string, unknown>;
    log(
      `✓ dev-api-2 trabalhando: branch=${String(p.sourceBranch)} status=${extra.status}`,
    );
  }

  // --- 4. Trava de merge: nem autonomia nem permissions.json sobrescrevem ---
  log('\n--- 4. trava de merge em branch protegida ---');
  await autonomy.upsert(project.id, 'dev-api', 'git_merge', 'auto_approve');
  await permissions.addPattern(project.id, 'allow', 'GitMerge()');
  log('✓ agent_autonomy=auto_approve E permissions.json allow GitMerge()');

  const merge = await app
    .get(ProposeActionUseCase)
    .execute(project.id, sessionId, {
      actionType: 'git_merge',
      actor: { kind: 'agent', id: 'dev-api' },
      payload: { pullRequestId: '1', targetBranch: 'dev' },
    });
  log(`→ merge em "dev": status=${merge.status}`);
  if (merge.status === 'auto_approved') {
    throw new Error(
      'TRAVA DE MERGE FUROU: merge em branch protegida foi auto-aprovado',
    );
  }
  // `denied` também não é auto-aprovação, mas aqui seria um falso positivo:
  // significaria que a ação morreu no IAM antes de a trava ser exercitada.
  if (merge.status !== 'pending') {
    throw new Error(
      `esperava "pending" (a trava rebaixa auto_approve → require_approval), veio "${merge.status}" ` +
        '— a trava não chegou a ser exercitada',
    );
  }
  log('✓ rejeitado (pending): merge em branch protegida é SEMPRE manual');

  // Contraprova: a mesma configuração auto-aprova um destino não protegido.
  const mergeFeature = await app
    .get(ProposeActionUseCase)
    .execute(project.id, sessionId, {
      actionType: 'git_merge',
      actor: { kind: 'agent', id: 'dev-api' },
      payload: { pullRequestId: '2', targetBranch: 'feature/x' },
    });
  // O que importa aqui é que a trava NÃO rebaixou pra `pending`. O merge é
  // auto-aprovado e sai executando de verdade — e falha, porque a PR nº 2 não
  // existe neste repo de demo. `failed` só é alcançável a partir de
  // auto_approved/approved (ver action-state-machine.ts), então serve de
  // prova de que a auto-aprovação aconteceu.
  if (mergeFeature.status === 'pending') {
    throw new Error(
      'contraprova falhou: merge em destino NÃO protegido também caiu em "pending" ' +
        '— a trava estaria bloqueando merge em geral, não só o destino protegido',
    );
  }
  log(
    `✓ contraprova — merge em "feature/x": status=${mergeFeature.status} ` +
      '(auto-aprovado: a trava é do destino, não um bloqueio geral)',
  );

  // --- Feed ---
  log('\n--- event log da execução ---');
  const eventos = await db
    .select()
    .from(sessionEvents)
    .where(eq(sessionEvents.sessionId, sessionId));
  eventos.sort((a, b) => a.seq - b.seq);
  for (const e of eventos) {
    log(`#${e.seq} ${e.type} ${JSON.stringify(e.payload)}`);
  }

  await app.close();
}

main().catch((error) => {
  console.error('\nDemo falhou:', error);
  process.exit(1);
});
