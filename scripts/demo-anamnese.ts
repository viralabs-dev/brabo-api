/**
 * Demo do critério de aceite da Fase 4b, sessão 2 (ADR 0016/0023): a Anamnese
 * propõe 1 patch com diff compreensível; aceitar uma hipótese do Psicólogo faz
 * o patch seguinte referenciá-la; o rollback devolve o agente ao comportamento
 * anterior.
 *
 * Uso: pnpm --filter api demo:anamnese
 *
 * PRÉ-REQUISITOS: stack de pé (`pnpm dev` ou `pnpm dev:gpu`), Ollama servindo
 * um modelo que sustente tool call com argumento estruturado (ver
 * demo-psicologo.ts: nesta stack, `qwen2.5-coder:7b`), engine COM o drain do
 * outbox ligado, e execução DE DENTRO do container da api.
 *
 * O que é DETERMINÍSTICO aqui (asserção dura, independe do modelo):
 *   - o catálogo derivado de uma stack COMPOSTA libera a tecnologia isolada;
 *   - competência sensível é rejeitada pelo guarda-corpo;
 *   - patch -> aprovação -> versão nova com `sourceHypothesisId` -> rollback
 *     que volta o conteúdo criando OUTRA versão (nada apagado);
 *   - a fila da hipótese só é consumida quando um patch a referencia;
 *   - perfil apagado não é re-derivado (opt-out).
 *
 * O que DEPENDE do modelo (reportado, e falha o script se não vier — é o
 * critério de aceite): a rodada gravar perfil de proficiência com evidência
 * apontando pra evento real, e propor um `instruction_patch` com diff não
 * vazio.
 *
 * EFEITOS EM DADOS COMPARTILHADOS (script de dev): cria projeto-cobaia novo a
 * cada execução e mexe no binding agent-scoped `anamnese`, que é GLOBAL. Rode
 * `pnpm --filter api seed` pra voltar ao estado semeado.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { and, eq } from 'drizzle-orm';
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
  agentInstructionVersions,
  anamneseQueue,
} from '../src/db/schema';
import { SetModelBindingUseCase } from '../src/application/use-cases/llm/set-model-binding.use-case';
import { CreateSessionUseCase } from '../src/application/use-cases/sessions/create-session.use-case';
import { TransitionSessionUseCase } from '../src/application/use-cases/sessions/transition-session.use-case';
import { AppendSessionEventUseCase } from '../src/application/use-cases/sessions/append-session-event.use-case';
import { ProposeActionUseCase } from '../src/application/use-cases/actions/propose-action.use-case';
import { ApproveActionUseCase } from '../src/application/use-cases/actions/approve-action.use-case';
import { DenyActionUseCase } from '../src/application/use-cases/actions/deny-action.use-case';
import { ProposeHypothesesUseCase } from '../src/application/use-cases/execution/propose-hypotheses.use-case';
import { AcceptHypothesisUseCase } from '../src/application/use-cases/execution/accept-hypothesis.use-case';
import { ProposeInstructionPatchUseCase } from '../src/application/use-cases/instructions/propose-instruction-patch.use-case';
import { ListInstructionVersionsUseCase } from '../src/application/use-cases/instructions/list-instruction-versions.use-case';
import { RollbackInstructionUseCase } from '../src/application/use-cases/instructions/rollback-instruction.use-case';
import { RecordProficiencyUseCase } from '../src/application/use-cases/anamnese/record-proficiency.use-case';
import { RunAnamneseUseCase } from '../src/application/use-cases/anamnese/run-anamnese.use-case';
import {
  DeleteProficiencyProfileUseCase,
  ListProficiencyProfilesUseCase,
} from '../src/application/use-cases/anamnese/manage-proficiency.use-case';
import { GetAnamneseContextUseCase } from '../src/application/use-cases/anamnese/get-anamnese-context.use-case';
import { GetProjectEventUseCase } from '../src/application/use-cases/sessions/get-project-event.use-case';
import { ModuleMapRepository } from '../src/application/ports/module-map-repository.port';
import { AgentInstructionRepository } from '../src/application/ports/agent-instruction-repository.port';
import { ProposedActionRepository } from '../src/application/ports/proposed-action-repository.port';
import { deriveCatalog } from '../src/domain/anamnese/competency-catalog';
import { chaveDeAgente } from '../src/domain/llm/binding-scope-id';

const MODELO = process.env.DEMO_MODEL ?? 'qwen2.5-coder:7b';

// STACK COMPOSTA de propósito: é exatamente o caso em que o catálogo antigo
// punha a frase inteira como UMA competência e rejeitava o lote todo.
const STACK_COMPOSTA = 'NestJS + Drizzle + Postgres';

const AGENTE_ALVO = 'dev-api';
const INSTRUCAO_ORIGINAL =
  'Você é o dev-api.\nExplique cada conceito básico antes de implementar.\n';
const INSTRUCAO_PATCHEADA =
  'Você é o dev-api.\nAssuma familiaridade com NestJS e vá direto ao ponto.\n';

const TIMEOUT_RODADA_MS = Number(
  process.env.DEMO_ANAMNESE_TIMEOUT_MS ?? 15 * 60 * 1000,
);

function log(msg: string) {
  console.log(msg);
}

const falhas: string[] = [];
function exigir(condicao: boolean, mensagem: string) {
  log(`  ${condicao ? '✓' : '✗'} ${mensagem}`);
  if (!condicao) falhas.push(mensagem);
}

async function esperar(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

/** Interações do usuário — o material sobre o qual a Anamnese opina. */
const CONVERSA = [
  {
    type: 'chat.message',
    actor: 'user',
    texto: 'preciso de um módulo de auth',
  },
  {
    type: 'agent.response',
    actor: 'dev-api',
    texto: 'vou explicar o que é injeção de dependência antes',
  },
  {
    type: 'chat.message',
    actor: 'user',
    texto:
      'não precisa explicar DI, eu escrevo NestJS há anos — só usa um guard',
  },
  { type: 'agent.response', actor: 'dev-api', texto: 'entendi, usando guard' },
  {
    type: 'chat.message',
    actor: 'user',
    texto: 'e usa transação do Drizzle no repositório, não no controller',
  },
  {
    type: 'agent.response',
    actor: 'dev-api',
    texto: 'movendo a transação pro repositório',
  },
  {
    type: 'chat.message',
    actor: 'user',
    texto: 'rebase antes de abrir a PR, não merge da dev',
  },
  { type: 'tool.result', actor: 'dev-api', texto: 'testes: 7 de 7 passaram' },
];

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error'],
  });
  const db = app.get<DrizzleDb>(DRIZZLE);
  const moduleMaps = app.get(ModuleMapRepository);
  const instructions = app.get(AgentInstructionRepository);
  const proposedActions = app.get(ProposedActionRepository);
  const setModelBinding = app.get(SetModelBindingUseCase);
  const createSession = app.get(CreateSessionUseCase);
  const transition = app.get(TransitionSessionUseCase);
  const appendEvent = app.get(AppendSessionEventUseCase);
  const proposeAction = app.get(ProposeActionUseCase);
  const approveAction = app.get(ApproveActionUseCase);
  const denyAction = app.get(DenyActionUseCase);
  const proposeHypotheses = app.get(ProposeHypothesesUseCase);
  const acceptHypothesis = app.get(AcceptHypothesisUseCase);
  const proposePatch = app.get(ProposeInstructionPatchUseCase);
  const listVersions = app.get(ListInstructionVersionsUseCase);
  const rollback = app.get(RollbackInstructionUseCase);
  const recordProficiency = app.get(RecordProficiencyUseCase);
  const runAnamnese = app.get(RunAnamneseUseCase);
  const listProfiles = app.get(ListProficiencyProfilesUseCase);
  const deleteProfile = app.get(DeleteProficiencyProfileUseCase);
  const anamneseContext = app.get(GetAnamneseContextUseCase);
  const getProjectEvent = app.get(GetProjectEventUseCase);

  const sufixo = Date.now();

  // --- projeto-cobaia ---
  const [user] = await db
    .insert(users)
    .values({
      keycloakSub: `demo-anam-${sufixo}`,
      email: `demo-anam-${sufixo}@brabo.dev`,
    })
    .returning();
  const [workspace] = await db
    .insert(workspaces)
    .values({ name: 'demo', slug: `demo-anam-${sufixo}`, createdBy: user.id })
    .returning();
  const [project] = await db
    .insert(projects)
    .values({
      workspaceId: workspace.id,
      name: 'cobaia-anamnese',
      slug: `cobaia-anam-${sufixo}`,
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
  await setModelBinding.execute(
    'agent',
    chaveDeAgente(project.id, 'anamnese'),
    modelo.id,
    user.id,
  );
  await setModelBinding.execute('project', project.id, modelo.id, user.id);
  log(`✓ anamnese -> ollama/${MODELO}`);

  const session = await createSession.execute(project.id, user.id, {
    kind: 'criativa',
  });
  await transition.execute(project.id, session.id, 'active');

  await moduleMaps.create({
    projectId: project.id,
    sessionId: session.id,
    version: 1,
    modules: [
      {
        name: 'api',
        stack: STACK_COMPOSTA,
        responsibility: 'API HTTP do produto',
        dependsOn: [],
      },
    ],
  });
  await instructions.upsert({
    projectId: project.id,
    agent: AGENTE_ALVO,
    content: INSTRUCAO_ORIGINAL,
  });
  log(`✓ module_map com stack composta: "${STACK_COMPOSTA}"`);

  // --- material da janela: conversa + decisões do usuário ---
  const eventIds: string[] = [];
  for (const turno of CONVERSA) {
    const event = await appendEvent.execute(project.id, session.id, {
      type: turno.type,
      actor: {
        kind: turno.actor === 'user' ? ('user' as const) : ('agent' as const),
        id: turno.actor,
      },
      payload: { content: turno.texto },
    });
    eventIds.push((event as { id: string }).id);
  }

  // "comandos que aprova/nega" é um dos quatro sinais do enunciado, e vem de
  // proposed_actions — não do event log.
  const aprovada = await proposeAction.execute(project.id, session.id, {
    actionType: 'terminal',
    actor: { kind: 'agent', id: AGENTE_ALVO },
    payload: { command: 'pnpm test' },
  });
  if (aprovada.status === 'pending') {
    await approveAction.execute(project.id, session.id, aprovada.id, user.id);
  }
  const negada = await proposeAction.execute(project.id, session.id, {
    actionType: 'terminal',
    actor: { kind: 'agent', id: AGENTE_ALVO },
    payload: { command: 'pnpm drizzle-kit push --force' },
  });
  if (negada.status === 'pending') {
    await denyAction.execute(
      project.id,
      session.id,
      negada.id,
      user.id,
      'nunca use push --force, gere migration',
    );
  }
  log(`✓ janela: ${CONVERSA.length} eventos + 1 aprovação + 1 negação`);

  // --- catálogo e guarda-corpo (determinístico) ---
  log('\n--- guarda-corpo do catálogo ---');
  const catalogo = deriveCatalog([STACK_COMPOSTA]);
  exigir(
    catalogo.has('nestjs') &&
      catalogo.has('drizzle') &&
      catalogo.has('postgres'),
    'stack composta libera cada tecnologia isolada',
  );
  exigir(
    !catalogo.has('ansiedade') && !catalogo.has('personalidade'),
    'atributo sensível continua fora do catálogo',
  );

  let sensivelRejeitada = false;
  try {
    await recordProficiency.execute(project.id, {
      sessionId: session.id,
      windowFrom: new Date(Date.now() - 3600_000),
      windowTo: new Date(),
      eventCount: CONVERSA.length,
      profiles: [
        {
          userId: user.id,
          competency: 'ansiedade',
          level: 'avancado',
          rationale: 'tentativa de perfilar atributo sensível',
          evidenceEventIds: [eventIds[0]],
        },
      ],
    });
  } catch {
    sensivelRejeitada = true;
  }
  exigir(
    sensivelRejeitada,
    'gravar competência sensível é rejeitado no domínio, não só no prompt',
  );

  // --- decisões chegam no contexto da rodada (determinístico) ---
  log('\n--- contexto da rodada ---');
  const ctx = await anamneseContext.execute(project.id);
  exigir(
    ctx.decisions.length >= 2,
    `decisões do usuário no contexto (${ctx.decisions.length}) — ` +
      'aprovação que já executou conta, o status dela não é mais "approved"',
  );
  log(
    `    ${ctx.decisions.map((d) => `${d.status} ${d.actionType}`).join(' · ')}`,
  );
  exigir(
    ctx.decisions.some((d) =>
      (d.rejectionReason ?? '').includes('push --force'),
    ),
    'o MOTIVO da negação chega no contexto (o sinal mais rico da janela)',
  );
  exigir(
    ctx.competencyCatalog.includes('drizzle'),
    'o catálogo do contexto já vem tokenizado',
  );

  // --- rodada de verdade (depende do modelo) ---
  log('\n--- rodada da Anamnese (pode levar minutos com modelo local) ---');
  await runAnamnese.execute(project.id);

  const limite = Date.now() + TIMEOUT_RODADA_MS;
  let perfis = await listProfiles.execute(project.id, user.id);
  while (Date.now() < limite && perfis.length === 0) {
    await esperar(10_000);
    perfis = await listProfiles.execute(project.id, user.id);
    log(`  ${perfis.length} perfil(is)`);
  }

  exigir(perfis.length > 0, `a rodada gravou perfil (${perfis.length})`);
  for (const perfil of perfis) {
    log(
      `    ${perfil.competency} = ${perfil.level} — ${perfil.rationale.slice(0, 70)}`,
    );
    exigir(
      catalogo.has(perfil.competency),
      `competência "${perfil.competency}" está no catálogo`,
    );
    let evidenciasOk = perfil.evidenceEventIds.length > 0;
    for (const eventId of perfil.evidenceEventIds) {
      try {
        await getProjectEvent.execute(project.id, eventId);
      } catch {
        evidenciasOk = false;
        log(`    ! evidência ${eventId} não resolve neste projeto`);
      }
    }
    exigir(
      evidenciasOk,
      `evidência de "${perfil.competency}" resolve em evento real do projeto`,
    );
  }

  // --- loop fechado: hipótese aceita -> fila -> patch (determinístico) ---
  log('\n--- loop fechado hipótese -> patch -> versão ---');
  // Sem fechar a sessão de propósito: o Monitor do engine fecha por
  // heartbeat_timeout (30s por default) muito antes de a rodada terminar, e
  // `ProposeHypothesesUseCase` não exige sessão encerrada — exige só que ela
  // exista. Tentar transicionar aqui estourava InvalidSessionTransitionError.

  const { hypotheses } = await proposeHypotheses.execute(
    project.id,
    session.id,
    {
      tier: 'leve',
      triggeredBy: 'manual',
      eventCount: CONVERSA.length,
      cause: 'normal',
      hypotheses: [
        {
          agenteAlvo: AGENTE_ALVO,
          observacao: 'o usuário cortou a explicação de DI',
          hipotese: 'o dev-api explica básico demais para este usuário',
          sugestao: 'assumir familiaridade com NestJS',
          confiancaPercent: 80,
          evidenceEventIds: [eventIds[2]],
        },
      ],
    },
  );
  const hipotese = hypotheses[0];
  await acceptHypothesis.execute(project.id, hipotese.id, user.id);

  const [naFila] = await db
    .select()
    .from(anamneseQueue)
    .where(eq(anamneseQueue.hypothesisId, hipotese.id));
  exigir(
    naFila?.status === 'pending',
    'aceitar a hipótese enfileira ela como input priorizado',
  );

  // Uma rodada que NÃO propõe patch não pode queimar a hipótese.
  await recordProficiency.execute(project.id, {
    sessionId: session.id,
    windowFrom: new Date(Date.now() - 3600_000),
    windowTo: new Date(),
    eventCount: CONVERSA.length,
    profiles: [
      {
        userId: user.id,
        competency: 'nestjs',
        level: 'avancado',
        rationale: 'dispensou explicação de DI e citou guard direto',
        evidenceEventIds: [eventIds[2]],
      },
    ],
  });
  const [aposRodadaSemPatch] = await db
    .select()
    .from(anamneseQueue)
    .where(eq(anamneseQueue.hypothesisId, hipotese.id));
  exigir(
    aposRodadaSemPatch?.status === 'pending',
    'rodada SEM patch não consome a hipótese (ela volta na próxima)',
  );

  const patch = await proposePatch.execute(project.id, session.id, {
    agent: AGENTE_ALVO,
    proposedContent: INSTRUCAO_PATCHEADA,
    rationale: 'usuário é sênior em NestJS — parar de explicar o básico',
    hypothesisId: hipotese.id,
  });
  const patchPayload = patch.payload as {
    files?: { lines?: unknown[] }[];
    hypothesisId?: string;
  };
  exigir(
    (patchPayload.files?.[0]?.lines?.length ?? 0) > 0,
    'o patch nasce com diff calculado (o que a UI renderiza)',
  );
  exigir(
    patch.status === 'pending',
    `patch exige aprovação humana (status=${patch.status}, nunca auto-aprovável)`,
  );
  exigir(
    patchPayload.hypothesisId === hipotese.id,
    'o patch referencia a hipótese que o originou',
  );

  const [aposPatch] = await db
    .select()
    .from(anamneseQueue)
    .where(eq(anamneseQueue.hypothesisId, hipotese.id));
  exigir(
    aposPatch?.status === 'consumed',
    'a hipótese é consumida quando o patch nasce',
  );

  // --- aprovação -> versão -> rollback (determinístico) ---
  log('\n--- aprovação, versão e rollback ---');
  await approveAction.execute(project.id, session.id, patch.id, user.id);

  const atual = await instructions.findByProjectAndAgent(
    project.id,
    AGENTE_ALVO,
  );
  exigir(
    atual?.content === INSTRUCAO_PATCHEADA,
    'aprovar aplica o patch na instrução vigente',
  );

  const versoes = await listVersions.execute(project.id, AGENTE_ALVO);
  const nova = versoes.find((v) => v.content === INSTRUCAO_PATCHEADA);
  exigir(!!nova, 'nasceu uma versão nova no histórico');
  exigir(
    nova?.sourceHypothesisId === hipotese.id,
    'a versão gravada carrega a hipótese de origem (rastreabilidade completa)',
  );

  const anterior = versoes.find((v) => v.content === INSTRUCAO_ORIGINAL);
  exigir(
    !!anterior,
    'a versão anterior está no histórico (backfill retroativo funcionou)',
  );

  if (anterior) {
    await rollback.execute(project.id, AGENTE_ALVO, anterior.version, user.id);

    const depoisDoRollback = await instructions.findByProjectAndAgent(
      project.id,
      AGENTE_ALVO,
    );
    exigir(
      depoisDoRollback?.content === INSTRUCAO_ORIGINAL,
      'rollback devolve o agente ao comportamento anterior',
    );

    const versoesDepois = await listVersions.execute(project.id, AGENTE_ALVO);
    exigir(
      versoesDepois.length === versoes.length + 1,
      'rollback é operação PRA FRENTE: cria versão nova, não apaga',
    );

    const todas = await db
      .select()
      .from(agentInstructionVersions)
      .where(
        and(
          eq(agentInstructionVersions.projectId, project.id),
          eq(agentInstructionVersions.agent, AGENTE_ALVO),
        ),
      );
    exigir(
      todas.some((v) => v.content === INSTRUCAO_PATCHEADA),
      'a versão revertida continua no banco (histórico preservado)',
    );
  }

  // --- patch negado não é reproposto igual (determinístico) ---
  log('\n--- negação registra pra não repropor igual ---');
  const paraNegar = await proposePatch.execute(project.id, session.id, {
    agent: AGENTE_ALVO,
    proposedContent: 'Você é o dev-api.\nSeja lacônico ao extremo.\n',
    rationale: 'teste de negação',
  });
  await denyAction.execute(
    project.id,
    session.id,
    paraNegar.id,
    user.id,
    'lacônico demais',
  );

  let reproposto = false;
  try {
    await proposePatch.execute(project.id, session.id, {
      agent: AGENTE_ALVO,
      proposedContent: 'Você é o dev-api.\nSeja lacônico ao extremo.\n',
      rationale: 'repetindo o que já foi negado',
    });
    reproposto = true;
  } catch {
    // esperado
  }
  exigir(
    !reproposto,
    'patch negado PELO USUÁRIO não pode ser reproposto igual',
  );

  const negadosNoBanco = await proposedActions.listByProjectAndType(
    project.id,
    'instruction_patch',
  );
  exigir(
    negadosNoBanco.some((a) => a.status === 'denied' && a.decidedBy !== null),
    'a negação fica registrada com o decisor humano',
  );

  // --- apagar o perfil não é cosmético (determinístico) ---
  log('\n--- perfil apagável e opt-out ---');
  const { deleted } = await deleteProfile.execute(project.id, user.id);
  exigir(deleted > 0, `apagar removeu ${deleted} linha(s) de perfil`);

  const depoisDeApagar = await listProfiles.execute(project.id, user.id);
  exigir(depoisDeApagar.length === 0, 'o perfil sai da listagem');

  const ctxDepois = await anamneseContext.execute(project.id);
  exigir(
    !ctxDepois.members.some((m) => m.userId === user.id),
    'quem apagou sai dos membros elegíveis — a rodada seguinte não re-deriva',
  );

  // --- desfecho ---
  log('\n=== resultado ===');
  if (falhas.length === 0) {
    log('✓ critério de aceite da Fase 4b (sessão 2) ATENDIDO');
    log(`  projeto: ${project.id} — abra Configurações pra navegar`);
  } else {
    log(`✗ ${falhas.length} verificação(ões) falharam:`);
    for (const f of falhas) log(`  - ${f}`);
  }

  await app.close();
  process.exit(falhas.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
