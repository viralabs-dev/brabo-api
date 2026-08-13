/**
 * Demo do critério de aceite do FECHAMENTO da Fase 4a (ADR 0014/0021): no
 * projeto-cobaia, o InfraAgent entrega uma PR com Dockerfile válido que passa
 * os gates (QA sintático + SecOps), e o painel do time mostra o estado real.
 *
 * Uso: pnpm --filter api demo:infra-agent
 *
 * PRÉ-REQUISITOS (as lições de ambiente do ADR 0020): stack de pé com GPU
 * (`pnpm dev:gpu`), modelo servido pelo Ollama, fila do Oban sem jobs de
 * Anamnese acumulados, e execução DE DENTRO do container da api.
 *
 * O gate de QA de infra roda `hadolint` e `yamllint` DE VERDADE — sem eles na
 * imagem do engine o veredito sai `approved` sem ter validado nada, que era o
 * estado antes do ADR 0021. O script confere a presença no fim.
 *
 * NÃO É DETERMINÍSTICO: o InfraAgent gera os arquivos via LLM. O que se exige
 * aqui é que a PR exista com pelo menos um Dockerfile e que os dois gates
 * tenham emitido parecer — não que o modelo escreva um Dockerfile específico.
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
  infraArtifacts,
} from '../src/db/schema';
import { ProvisionRepositoryUseCase } from '../src/application/use-cases/git/provision-repository.use-case';
import { SetModelBindingUseCase } from '../src/application/use-cases/llm/set-model-binding.use-case';
import { CreateHandoffUseCase } from '../src/application/use-cases/agents/create-handoff.use-case';
import { AcceptHandoffUseCase } from '../src/application/use-cases/agents/accept-handoff.use-case';
import { TransitionSessionUseCase } from '../src/application/use-cases/sessions/transition-session.use-case';
import { AppendSessionEventUseCase } from '../src/application/use-cases/sessions/append-session-event.use-case';
import { ProposeActionUseCase } from '../src/application/use-cases/actions/propose-action.use-case';
import { SessionRepository } from '../src/application/ports/session-repository.port';
import { ModuleMapRepository } from '../src/application/ports/module-map-repository.port';
import { ProvisionedRepositoryRepository } from '../src/application/ports/provisioned-repository-repository.port';
import { GitProviderRegistry } from '../src/application/ports/git-provider.port';

const MODELO = process.env.DEMO_MODEL ?? 'qwen2.5-coder:7b';

const MODULOS = [
  {
    name: 'api',
    stack: 'Node.js',
    responsibility: 'API HTTP do produto',
    dependsOn: [],
  },
  {
    name: 'worker',
    stack: 'Node.js',
    responsibility: 'processamento assíncrono',
    dependsOn: ['api'],
  },
];

// ADR marcado `infraRelevant` — é o filtro exato de GetInfraContextUseCase, que
// lista as proposed_actions `open_adr_pr` do projeto e fica só com essas.
const ADR_INFRA = {
  title: 'ADR 0001 — Containers por módulo',
  content: [
    'Cada módulo do module_map tem seu próprio Dockerfile, baseado em imagem',
    'Alpine com versão fixada. O compose de desenvolvimento sobe os módulos',
    'juntos. O pipeline de CI roda a suite em push.',
  ].join('\n'),
  infraRelevant: true,
};

const SKELETON = [
  {
    path: 'package.json',
    content: JSON.stringify(
      { name: 'cobaia-infra', version: '1.0.0', private: true },
      null,
      2,
    ),
  },
  {
    path: 'README.md',
    content: '# cobaia-infra\n\nProjeto-cobaia do demo do InfraAgent.\n',
  },
];

function log(msg: string) {
  console.log(msg);
}

interface Parecer {
  seq: number;
  gate: 'qa' | 'secops';
  veredito: string;
  resumo: string;
  itens: string[];
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
    .filter((e) => (e.payload as { prActionId?: string }).prActionId)
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
  const repos = app.get(ProvisionedRepositoryRepository);
  const registry = app.get(GitProviderRegistry);

  const sufixo = Date.now();

  const [user] = await db
    .insert(users)
    .values({
      keycloakSub: `demo-infra-${sufixo}`,
      email: `demo-infra-${sufixo}@brabo.dev`,
    })
    .returning();
  const [workspace] = await db
    .insert(workspaces)
    .values({ name: 'demo', slug: `demo-infra-${sufixo}`, createdBy: user.id })
    .returning();
  const [project] = await db
    .insert(projects)
    .values({
      workspaceId: workspace.id,
      name: 'cobaia-infra',
      slug: `cobaia-infra-${sufixo}`,
      createdBy: user.id,
    })
    .returning();
  await db
    .insert(projectMembers)
    .values({ projectId: project.id, userId: user.id, role: 'owner' });
  log(`✓ projeto-cobaia: ${project.id}`);

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
  log(`✓ modelo do projeto: ${modelo.provider}/${modelo.name}`);

  await app.get(ProvisionRepositoryUseCase).execute(project.id, user.id, {
    provider: 'local',
    name: `cobaia-infra-${sufixo}`,
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
  log('✓ repo provisionado');

  // --- Sessão ativa + module_map + ADR de infra ---
  const session = await sessions.create({
    projectId: project.id,
    createdBy: user.id,
    // Demo/roteiro exercita o caminho de EXECUÇÃO — `criativa` (RN-097).
    kind: 'criativa' as const,
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

  // O ADR entra como a proposed_action que o Arquiteto criaria — é dela que
  // GetInfraContextUseCase lê (e ele não filtra por status da ação).
  await app.get(ProposeActionUseCase).execute(project.id, session.id, {
    actionType: 'open_adr_pr',
    actor: { kind: 'agent', id: 'arquiteto' },
    payload: ADR_INFRA,
  });
  log(
    `✓ module_map (${MODULOS.map((m) => m.name).join(', ')}) + ADR infraRelevant`,
  );

  // --- Handoff arquiteto → infra, aceito pelo usuário ---
  // O aceite é o que seeda a autonomia (open_infra_pr auto_approve, terminal
  // deny) e ativa o agente — o mesmo caminho da UI.
  const handoff = await app
    .get(CreateHandoffUseCase)
    .execute(project.id, session.id, {
      fromAgent: 'arquiteto',
      toAgent: 'infra',
    });

  log('\n--- aceitando o handoff (ativa o InfraAgent) ---');
  await app
    .get(AcceptHandoffUseCase)
    .execute(project.id, session.id, handoff.id, user.id);
  log(`✓ sessão: ${session.id}`);

  // --- Acompanhamento ---
  const limite = Date.now() + Number(process.env.DEMO_TIMEOUT_MS ?? 1_800_000);
  let ultimoResumo = '';
  let artefato: typeof infraArtifacts.$inferSelect | undefined;

  for (;;) {
    const [linha] = await db
      .select()
      .from(infraArtifacts)
      .where(eq(infraArtifacts.projectId, project.id));
    artefato = linha;

    const eventos = await db
      .select()
      .from(sessionEvents)
      .where(eq(sessionEvents.sessionId, session.id));
    const quantos = pareceres(eventos.sort((a, b) => a.seq - b.seq)).length;

    const resumo = artefato
      ? `gate=${artefato.gateStatus} correções=${artefato.gateCorrectionCount} pareceres=${quantos}${artefato.blocked ? ' (BLOCKED)' : ''}`
      : `aguardando a PR de infra (pareceres=${quantos})`;
    if (resumo !== ultimoResumo) {
      log(`  ${resumo}`);
      ultimoResumo = resumo;
    }

    const terminou =
      artefato && (artefato.gateStatus === 'awaiting_user' || artefato.blocked);
    if (terminou || Date.now() > limite) break;
    await new Promise((r) => setTimeout(r, 5_000));
  }

  // --- Resultado ---
  log('\n--- linha do tempo da PR de infra ---');
  const eventos = (
    await db
      .select()
      .from(sessionEvents)
      .where(eq(sessionEvents.sessionId, session.id))
  ).sort((a, b) => a.seq - b.seq);

  const obtidos = pareceres(eventos);
  log('infra → PR proposta');
  for (const p of obtidos) {
    log(`${p.gate} → ${p.veredito}: ${p.resumo}`);
    for (const item of p.itens) log(`     - ${item}`);
  }
  log(`você → gate atual: ${artefato?.gateStatus ?? '-'}`);

  const [prAction] = await db
    .select()
    .from(proposedActions)
    .where(
      and(
        eq(proposedActions.projectId, project.id),
        eq(proposedActions.actionType, 'open_infra_pr'),
      ),
    );

  const arquivos =
    (prAction?.payload as { files?: { path: string }[] } | undefined)?.files ??
    [];
  if (prAction) {
    const r = prAction.executionResult as Record<string, unknown> | null;
    log(
      `\nPR: ${String(r?.pullRequestUrl ?? '-')} (status=${prAction.status})`,
    );
    log(`arquivos: ${arquivos.map((f) => f.path).join(', ') || '(nenhum)'}`);
  }

  // --- Critério de aceite ---
  log('\n--- critério de aceite ---');
  const falhas: string[] = [];

  if (!prAction) {
    falhas.push('o InfraAgent não chegou a propor uma PR de infra');
  } else if (prAction.status !== 'executed') {
    falhas.push(`a PR de infra não foi executada (status=${prAction.status})`);
  }

  const temDockerfile = arquivos.some((f) =>
    f.path.toLowerCase().includes('dockerfile'),
  );
  if (!temDockerfile) falhas.push('a PR não tem nenhum Dockerfile');

  if (artefato?.blocked) {
    falhas.push(
      `artefato bloqueado: ${artefato.blockedReason ?? '(sem motivo)'}`,
    );
  }
  if (artefato?.gateStatus !== 'awaiting_user') {
    falhas.push(
      `gate final é "${artefato?.gateStatus ?? '-'}", esperado "awaiting_user"`,
    );
  }

  const gatesQuePassaram = new Set(
    obtidos.filter((p) => p.veredito === 'approved').map((p) => p.gate),
  );
  for (const gate of ['qa', 'secops'] as const) {
    if (!gatesQuePassaram.has(gate)) {
      falhas.push(`o gate de ${gate} não aprovou`);
    }
  }

  // O gate só vale se os validadores existirem — sem eles ele aprova vazio,
  // que é exatamente o defeito que o ADR 0021 corrigiu.
  const resumoQa = obtidos.find((p) => p.gate === 'qa')?.resumo ?? '';
  if (resumoQa.includes('hadolint indisponível')) {
    falhas.push(
      'hadolint ausente no engine — o gate de QA aprovou sem validar',
    );
  }
  if (resumoQa.includes('yamllint indisponível')) {
    falhas.push(
      'yamllint ausente no engine — compose e CI não foram validados',
    );
  }

  await app.close();

  if (falhas.length > 0) {
    log('✗ NÃO fechou:');
    for (const f of falhas) log(`  - ${f}`);
    log(`\nProjeto pra inspeção: ${project.id}`);
    process.exit(1);
  }

  log('✓ PR de infra com Dockerfile passou QA e SecOps, em awaiting_user');
  log(
    `\nAbra a visão geral do projeto pra conferir o painel do time: ${project.id}`,
  );
}

main().catch((error) => {
  console.error('\nDemo falhou:', error);
  process.exit(1);
});
