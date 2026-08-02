/**
 * Critério de aceite da FASE 12, numa execução única (12d).
 *
 * Uso: pnpm --filter api validacao:fase-12
 *
 * Prova que os três achados P1 do dogfooding morreram, em UMA corrida:
 *
 *   #1  adoção de repositório existente — sem seed manual em tabela nenhuma
 *   #10 reagendamento do dev agent      — sem restart do engine entre tasks
 *   #13 promoção de story pelo usuário  — nada é pegável antes da decisão
 *
 * Sai com código != 0 quando o critério não fecha: isto é um critério de
 * aceite, não um relatório.
 *
 * PRÉ-REQUISITOS: os mesmos do `demo-noop-execution` — stack de dev de pé, api
 * e engine compartilhando o FS de `GIT_LOCAL_REPOS_ROOT` e
 * `PROJECT_WORKSPACES_ROOT`, e execução DE DENTRO do container da api.
 *
 * ## O que esta validação NÃO prova
 *
 * Ela roda com o **LocalGitProvider** e o **NoopDevAgent**, e o veredito de
 * gate é gravado pelo script. Isso é deliberado, e o documento
 * `docs/explanation/validacao-fase-12.md` repete com todas as letras:
 *
 * - **Não prova GitHub remoto.** O fork da Fase 10 nunca foi nomeado
 *   (`dogfooding-mission.md:135` ainda é um `TODO(humano)`), então não há alvo.
 *   O que o caminho de adoção faz é idêntico nos dois providers — `getRepo`,
 *   plano, `origin: 'adopted'` —, e a diferença de rede está coberta pelo
 *   smoke `adopt-repository.smoke.spec.ts`, gated por `ADOPT_TEST_REPO`.
 * - **Não prova o JULGAMENTO dos gates.** O QA e o SecOps são agentes de LLM;
 *   aqui o veredito entra pelo `RecordGateVerdictUseCase`, que é o funil REAL
 *   por onde o parecer deles passa e onde nasce o `task.gate_resolved`. O que
 *   a Fase 12b precisa provar é a cadeia veredito → outbox → wake → claim, não
 *   se o modelo sabe ler um teste. O julgamento continua coberto pelos aceites
 *   da Fase 4a — que, por sinal, `demo-pr-gates.ts:18-24` declara NÃO
 *   determinísticos com modelo local.
 * - **Não faz merge.** Merge em branch protegida é do usuário, por desenho, e
 *   o passo 6 mostra a trava recusando exatamente isso.
 */
import 'reflect-metadata';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { NestFactory } from '@nestjs/core';
import { and, eq, inArray } from 'drizzle-orm';
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
  projectRepositories,
  repoBootstraps,
  sessionEvents,
} from '../src/db/schema';
import { AdoptRepositoryUseCase } from '../src/application/use-cases/git/adopt-repository.use-case';
import { DecideBootstrapPlanUseCase } from '../src/application/use-cases/git/decide-bootstrap-plan.use-case';
import { AppendSessionEventUseCase } from '../src/application/use-cases/sessions/append-session-event.use-case';
import { CreateStoryUseCase } from '../src/application/use-cases/backlog/create-story.use-case';
import { PromoteStoriesUseCase } from '../src/application/use-cases/backlog/promote-stories.use-case';
import { ActivateExecutionUseCase } from '../src/application/use-cases/execution/activate-execution.use-case';
import { RecordGateVerdictUseCase } from '../src/application/use-cases/execution/record-gate-verdict.use-case';
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

const exec = promisify(execFile);

const MODULOS = [
  {
    name: 'api',
    stack: 'NestJS',
    responsibility: 'regras de negócio e endpoints',
    dependsOn: [],
  },
];

/** As linhas da tabela de evidência do documento. */
const evidencia: { etapa: string; evento: string }[] = [];

function log(msg: string) {
  console.log(msg);
}

function assertar(condicao: boolean, mensagem: string) {
  if (!condicao) throw new Error(`CRITÉRIO NÃO FECHOU: ${mensagem}`);
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
    if (Date.now() > limite) throw new Error(`timeout esperando: ${rotulo}`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

/**
 * Um bare repo com política DIVERGENTE do template do Brabo: tem `main` e
 * `develop`, não tem `qa` nem `rc`. É o caso real que a RN-045 endereça — um
 * repositório que já existia, com convenção própria, e que o produto não pode
 * reescrever sem plano aprovado.
 */
async function criarRepoDivergente(sufixo: string): Promise<string> {
  const raiz = await mkdtemp(join(tmpdir(), 'brabo-validacao-'));
  const bare = join(raiz, `adotado-${sufixo}.git`);
  const trabalho = join(raiz, 'trabalho');

  await exec('git', ['init', '--bare', '--initial-branch=main', bare]);
  await exec('git', ['init', '--initial-branch=main', trabalho]);
  await exec('git', ['-C', trabalho, 'config', 'user.email', 'v@brabo.dev']);
  await exec('git', ['-C', trabalho, 'config', 'user.name', 'validacao']);
  await exec('git', ['-C', trabalho, 'commit', '--allow-empty', '-m', 'inicial']);
  await exec('git', ['-C', trabalho, 'branch', 'develop']);
  await exec('git', ['-C', trabalho, 'remote', 'add', 'origin', bare]);
  await exec('git', ['-C', trabalho, 'push', '-q', 'origin', 'main', 'develop']);

  return bare;
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

  const sufixo = String(Date.now());

  const [user] = await db
    .insert(users)
    .values({
      keycloakSub: `validacao-12-${sufixo}`,
      email: `validacao-12-${sufixo}@brabo.dev`,
    })
    .returning();
  const [workspace] = await db
    .insert(workspaces)
    .values({ name: 'validação', slug: `val-12-${sufixo}`, createdBy: user.id })
    .returning();
  const [project] = await db
    .insert(projects)
    .values({
      workspaceId: workspace.id,
      name: 'validacao-fase-12',
      slug: `validacao-fase-12-${sufixo}`,
      createdBy: user.id,
    })
    .returning();
  await db
    .insert(projectMembers)
    .values({ projectId: project.id, userId: user.id, role: 'owner' });

  log(`projeto: ${project.id}`);

  // O default do produto tem de ser `manual` SEM ninguém configurar nada — é a
  // mudança de comportamento da 12c, e checá-la aqui evita que a validação
  // inteira passe com um projeto que estava em `auto` por acidente.
  assertar(
    project.storyPromotion === 'manual',
    `projeto novo nasceu em "${project.storyPromotion}"; o default da 12c é "manual"`,
  );
  log('✓ projeto novo nasce com promoção MANUAL (RN-048)');

  // ================= 1. ADOÇÃO (achado #1) =================
  log('\n--- 1. adotar um repositório que JÁ EXISTE ---');
  const bare = await criarRepoDivergente(sufixo);
  log(`repositório pré-existente: ${bare} (branches: main, develop)`);

  const adocao = await app
    .get(AdoptRepositoryUseCase)
    .execute(project.id, user.id, { provider: 'local', externalId: bare });

  assertar(adocao.repository.origin === 'adopted', 'origin deveria ser "adopted"');
  assertar(!adocao.alreadyAdopted, 'primeira adoção não pode vir como readoção');
  log(`✓ adotado: origin=${adocao.repository.origin} branch=${adocao.repository.defaultBranch}`);

  // O plano DIAGNOSTICA a divergência sem executar nada.
  assertar(
    adocao.plan.steps.length > 0,
    'o plano de bootstrap veio vazio — nada a diagnosticar num repo divergente?',
  );
  log(`✓ plano gerado: ${adocao.plan.steps.length} mutação(ões) que o Brabo FARIA`);
  for (const passo of adocao.plan.steps) {
    log(`    ${passo.step.padEnd(20)} ${passo.actionType}`);
  }
  for (const d of adocao.plan.diagnostics) {
    log(`    diagnóstico: ${d.kind} ${JSON.stringify(d.detail)}`);
  }

  // A política divergente é RECONHECIDA, não corrigida em silêncio: `develop`
  // não é do template, e `qa`/`rc` não existem no repo do usuário.
  const tiposDeDiagnostico = new Set(adocao.plan.diagnostics.map((d) => d.kind));
  assertar(
    tiposDeDiagnostico.has('missing_branch'),
    'o plano não apontou branch faltante num repo que não tem qa nem rc',
  );
  assertar(
    tiposDeDiagnostico.has('extra_branch'),
    'o plano não apontou a branch `develop`, que não é do template — a política própria do repo passou despercebida',
  );
  log('✓ divergência REAL diagnosticada (branch faltante e branch fora do template)');

  const bootstrapAntes = await db
    .select()
    .from(repoBootstraps)
    .where(eq(repoBootstraps.projectId, project.id));
  assertar(
    bootstrapAntes.every((b) => b.planDecision === null),
    'a decisão do plano deveria estar NULA antes de o usuário decidir',
  );
  log('✓ decisão NULA — nada foi alterado no repositório (RN-045)');

  // "Adotar como está": o usuário dispensa o bootstrap. O repositório do
  // usuário continua com a política DELE.
  await app.get(DecideBootstrapPlanUseCase).adoptAsIs(project.id, user.id, {
    planGeneratedAt: adocao.plan.generatedAt,
  });
  log('✓ adotado COMO ESTÁ — o template não foi forçado sobre o repo do usuário');
  evidencia.push({ etapa: '1. adoção', evento: 'bootstrap.adopted_as_is' });

  // A prova negativa do achado #1: nenhuma linha foi inserida à mão.
  const [repoRow] = await db
    .select()
    .from(projectRepositories)
    .where(eq(projectRepositories.projectId, project.id));
  assertar(
    repoRow.origin === 'adopted' && repoRow.externalId === bare,
    'a linha de repositório não reflete a adoção',
  );
  log('✓ ZERO seed manual: as duas linhas nasceram do caso de uso');

  // ================= 2. BACKLOG EM MODO MANUAL (achado #13) =================
  log('\n--- 2. o PO monta o backlog; nada fica pegável ---');
  const sessaoBacklog = await sessions.create({
    projectId: project.id,
    createdBy: user.id,
  });
  await moduleMaps.create({
    projectId: project.id,
    sessionId: sessaoBacklog.id,
    modules: MODULOS,
    version: 1,
  });

  const epic = await epics.create({
    projectId: project.id,
    sessionId: sessaoBacklog.id,
    title: 'Cadastro de usuários',
  });

  // A regra de negócio precisa existir no event log: `CreateStoryUseCase`
  // valida cada `businessRuleId` contra um `artifact.business_rule` real —
  // é a rastreabilidade da Fase 3b, e ela vale nos dois modos de promoção.
  // Emitida pelo caso de uso normal, não inserida na tabela: `seq` é denso por
  // sessão (RN-002) e escrever a linha à mão furaria a sequência.
  const eventoRegra = await app
    .get(AppendSessionEventUseCase)
    .execute(project.id, sessaoBacklog.id, {
      type: 'artifact.business_rule',
      actor: { kind: 'agent', id: 'criativo' },
      payload: { title: 'Só maiores de 18', description: 'idade >= 18' },
    });

  const story = await app
    .get(CreateStoryUseCase)
    .execute(project.id, sessaoBacklog.id, {
      epicId: epic.id,
      title: 'Cadastro de usuário maior de idade',
      rf: ['formulário de cadastro com data de nascimento'],
      dod: ['testes passando'],
      dor: ['regra de negócio definida'],
      businessRuleIds: [eventoRegra.id],
    });

  await stories.updateModules(story.id, ['api']);
  for (const titulo of ['Endpoint de cadastro', 'Validação de idade', 'Listagem']) {
    await tasks.create({ storyId: story.id, title: titulo });
  }

  assertar(story.status === 'draft', `story deveria ficar draft; veio "${story.status}"`);
  assertar(story.proposedReady, 'story completa deveria ter sido PROPOSTA ao usuário');
  log('✓ story completa ficou DRAFT, proposta ao usuário (não promovida sozinha)');
  evidencia.push({
    etapa: '2. backlog',
    evento: 'backlog.story_promotion_proposed',
  });

  // O coração do achado #13: sem a decisão do usuário, o claim não devolve nada.
  const claimAntes = await tasks.claimNext(project.id, 'api', 'dev-api-teste');
  assertar(
    claimAntes === null,
    'uma task foi reivindicável ANTES da promoção — o passo humano não está travando nada',
  );
  log('✓ claimNext devolve NULL: nenhuma tarefa é pegável antes da promoção');

  // ================= 3. PROMOÇÃO PELO USUÁRIO =================
  log('\n--- 3. o usuário promove ---');
  const resultado = await app
    .get(PromoteStoriesUseCase)
    .execute(project.id, [story.id], user.id);

  assertar(
    resultado.promoted.length === 1 && resultado.failed.length === 0,
    `promoção falhou: ${JSON.stringify(resultado.failed)}`,
  );

  const promovida = await stories.findById(story.id);
  assertar(promovida?.status === 'ready', 'a story não ficou ready');
  assertar(!promovida?.proposedReady, 'a proposta deveria ter sido desligada junto');
  log('✓ promovida por AÇÃO DO USUÁRIO — e a proposta saiu da fila');
  evidencia.push({ etapa: '3. promoção', evento: 'backlog.story_transitioned' });

  const promocao = await db
    .select()
    .from(sessionEvents)
    .where(
      and(
        eq(sessionEvents.sessionId, sessaoBacklog.id),
        eq(sessionEvents.type, 'backlog.story_transitioned'),
      ),
    );
  const ator = promocao[0];
  assertar(
    ator?.actorKind === 'user' && ator.actorId === user.id,
    `o evento registrou "${ator?.actorKind}/${ator?.actorId}" e não o usuário que decidiu`,
  );
  log('✓ o event log registra o USUÁRIO como quem promoveu, não o PO');

  // ================= 4. TRÊS TASKS, UM AGENTE, ZERO RESTARTS (achado #10) ===
  log('\n--- 4. execução: 3 tasks em sequência, sem restart do engine ---');
  const { sessionId } = await app
    .get(ActivateExecutionUseCase)
    .execute(project.id, user.id, undefined, undefined, 'noop');
  log(`sessão de execução: ${sessionId} (o engine NÃO será reiniciado daqui em diante)`);

  const idsDasTasks = (await tasks.findByStoryIds([story.id])).map((t) => t.id);
  const concluidas: string[] = [];

  for (let i = 1; i <= idsDasTasks.length; i++) {
    // Espera o agente abrir a PR da vez. É aqui que a Fase 12b é exercitada:
    // da segunda volta em diante, ninguém disparou `:work` — o agente
    // reivindicou sozinho, acordado pelo `task.gate_resolved` da volta anterior.
    const pr = await esperar(`PR da ${i}ª task`, async () => {
      const linhas = await db
        .select()
        .from(proposedActions)
        .where(
          and(
            eq(proposedActions.projectId, project.id),
            eq(proposedActions.actionType, 'pr_open'),
          ),
        );
      return linhas.length >= i ? linhas[i - 1] : null;
    });

    const emRevisao = await esperar(`task ${i} em revisão`, async () => {
      const todas = await tasks.findByStoryIds([story.id]);
      return (
        todas.find(
          (t) => t.gateStatus !== null && !concluidas.includes(t.id),
        ) ?? null
      );
    });

    log(`  ${i}ª task: ${emRevisao.title} — PR ${pr.status}, gate ${emRevisao.gateStatus}`);

    // O gate resolve. Este é o funil REAL: é ele que escreve
    // `task.gate_resolved` no outbox, que o engine consome e entrega ao agente.
    for (const gate of ['qa', 'secops'] as const) {
      const r = await app.get(RecordGateVerdictUseCase).execute(project.id, sessionId, {
        taskId: emRevisao.id,
        gate,
        veredito: 'approved',
        resumo: `parecer de ${gate} gravado pela validação da Fase 12`,
        itens: [],
      });
      if (r.nextAction === 'done') break;
    }

    concluidas.push(emRevisao.id);
    log(`  ✓ ${i}ª task aprovada nos dois gates`);
  }

  assertar(
    concluidas.length === 3,
    `esperava 3 tasks concluídas em sequência, foram ${concluidas.length}`,
  );
  log('✓ 3 tasks, 1 agente, 0 restarts do engine (achado #10)');
  evidencia.push({ etapa: '4. execução', evento: 'dev.awaiting_gate' });

  // ================= 5. IDLE EXPLÍCITO =================
  log('\n--- 5. fila vazia: idle, não processo morto ---');
  const idle = await esperar('dev.idle final', async () => {
    const [linha] = await db
      .select()
      .from(sessionEvents)
      .where(
        and(
          eq(sessionEvents.sessionId, sessionId),
          eq(sessionEvents.type, 'dev.idle'),
        ),
      );
    return linha ?? null;
  });
  log(`✓ agente em idle: ${JSON.stringify(idle.payload)}`);
  evidencia.push({ etapa: '5. idle', evento: 'dev.idle' });

  // ================= 6. O MERGE CONTINUA SENDO SEU =================
  log('\n--- 6. trava de merge (o que a fase NÃO mudou) ---');
  await app.get(AgentAutonomyRepository).upsert(project.id, 'dev-api', 'git_merge', 'auto_approve');
  await app.get(PermissionsFileStore).addPattern(project.id, 'allow', 'GitMerge()');

  const merge = await app.get(ProposeActionUseCase).execute(project.id, sessionId, {
    actionType: 'git_merge',
    actor: { kind: 'agent', id: 'dev-api' },
    payload: { pullRequestId: '1', targetBranch: 'main' },
  });
  assertar(
    merge.status === 'pending',
    `merge em branch protegida veio "${merge.status}" — a trava não segurou`,
  );
  log('✓ pending: merge em protegida continua sendo decisão sua, por desenho');

  // ================= EVIDÊNCIA =================
  //
  // A tabela do documento sai DAQUI, do banco, e não da narrativa de quem
  // rodou. O ponto da 12d é que a validação seja auditável: cada linha abaixo
  // é um `session_events.id` (ULID) que existe e pode ser consultado depois.
  log('\n--- evidência (event ids reais desta execução) ---\n');

  // A adoção emite na SESSÃO DELA (criada pelo próprio caso de uso), não na do
  // backlog nem na de execução — por isso as três entram na busca.
  const sessoesDoRun = [
    ...new Set([
      sessaoBacklog.id,
      sessionId,
      ...bootstrapAntes.map((b) => b.sessionId),
    ]),
  ];

  const desteRun = await db
    .select()
    .from(sessionEvents)
    .where(
      and(
        inArray(sessionEvents.sessionId, sessoesDoRun),
        inArray(sessionEvents.type, [
          'project.repository_adopted',
          'bootstrap.repository_adopted',
          'bootstrap.adopted_as_is',
          'backlog.story_promotion_proposed',
          'backlog.story_transitioned',
          'dev.working',
          'dev.awaiting_gate',
          'dev.idle',
        ]),
      ),
    );

  const ETAPA_POR_EVENTO: Record<string, string> = {
    'project.repository_adopted': '1. adoção',
    'bootstrap.repository_adopted': '1. adoção',
    'bootstrap.adopted_as_is': '1. adoção (como está)',
    'backlog.story_promotion_proposed': '2. o PO propõe',
    'backlog.story_transitioned': '3. você promove',
    'dev.working': '4. dev reivindica',
    'dev.awaiting_gate': '4. PR aberta, esperando o gate',
    'dev.idle': '5. fila vazia, agente ocioso',
  };

  desteRun.sort((a, b) =>
    a.createdAt.getTime() === b.createdAt.getTime()
      ? a.seq - b.seq
      : a.createdAt.getTime() - b.createdAt.getTime(),
  );

  log('| etapa | evento | id | seq |');
  log('|---|---|---|---|');
  for (const e of desteRun) {
    log(
      `| ${ETAPA_POR_EVENTO[e.type] ?? e.type} | \`${e.type}\` | \`${e.id}\` | ${e.seq} |`,
    );
  }

  // As etapas que o script AFIRMOU ter exercitado precisam aparecer na
  // evidência. Sem esta checagem, uma consulta errada produziria uma tabela
  // curta e a validação passaria mesmo assim — o modo de falha clássico de
  // relatório gerado.
  const tiposColhidos = new Set(desteRun.map((e) => e.type));
  for (const { etapa, evento } of evidencia) {
    assertar(
      tiposColhidos.has(evento),
      `a etapa "${etapa}" não deixou evidência de \`${evento}\` no event log`,
    );
  }

  log(`\nprojeto: ${project.id}`);
  log(`sessão do backlog: ${sessaoBacklog.id}`);
  log(`sessão de execução: ${sessionId}`);
  log('\n✓ CRITÉRIO DA FASE 12 FECHADO: os três achados, numa execução única.');

  await app.close();
}

main().catch((error) => {
  console.error('\nValidação falhou:', error);
  process.exit(1);
});
