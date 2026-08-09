/**
 * Demo do critério de aceite da Fase 4b, sessão 1 (ADR 0015/0022): encerrar
 * 3 sessões (normal, kill, erro) gera hipóteses com evidências navegáveis
 * nos 3 casos, e os custos de triagem leve e pesada divergem no metering.
 *
 * Uso: pnpm --filter api demo:psicologo
 *
 * PRÉ-REQUISITOS: stack de pé (`pnpm dev` ou `pnpm dev:gpu`), Ollama
 * servindo os modelos semeados, engine COM o drain do outbox ligado
 * (START_OUTBOX_DRAIN != "false" — é ele que entrega `session.closed` pro
 * PsychologistWorker), e execução DE DENTRO do container da api.
 *
 * NÃO É DETERMINÍSTICO: as hipóteses saem de um LLM. O que se exige aqui é
 * estrutural — que cada sessão encerrada renda uma análise current com ao
 * menos uma hipótese, que TODA evidência resolva num evento real da própria
 * sessão (pelo endpoint por id, o mesmo que a UI usa), que as duas sessões
 * anormais tragam `terminationAnalysis`, e que o custo da triagem leve fique
 * abaixo do da pesada. O TEXTO das hipóteses não é verificado.
 *
 * SOBRE O "KILL": o script reporta o término pelo mesmo caminho que o
 * `Engine.Sessions.Monitor` usa quando o processo morre de verdade
 * (`ReportSessionTerminationUseCase`, motivo "killed" -> closed_abnormally).
 * O que o Psicólogo consome é exatamente isso: `sessions.termination_reason`
 * + status. Matar o container do engine no meio de uma análise é o outro
 * cenário (resgate do job órfão pelo Oban.Plugins.Lifeline) e se verifica à
 * mão — ver ADR 0022.
 *
 * SOBRE OS PREÇOS: os modelos ollama são semeados com preço ZERO, e custo zero
 * nos dois tiers não provaria nada. O script atribui preços nominais distintos
 * (o seed diz explicitamente que preço é editável) e liga cada tier a um. O
 * custo continua saindo do caminho real — RunLlmTurnUseCase grava
 * `token_usage.cost_micros` do preço do modelo — sem nenhum mecanismo de custo
 * paralelo. Ver o comentário de MODELO_PESADO pro porquê da cópia no Ollama.
 *
 * EFEITOS EM DADOS COMPARTILHADOS (é um script de dev, não de produção): os
 * bindings de `psicologo`/`psicologo-leve` são agent-scoped, ou seja
 * GLOBAIS — rodar isto re-aponta os dois tiers pros modelos locais em todo o
 * ambiente, e os preços desses modelos mudam. Rode `pnpm --filter api seed`
 * pra voltar ao estado semeado.
 *
 * SOBRE O TETO DE ITERAÇÕES: o default do tier leve (4) foi calibrado pensando
 * em modelo forte. Um 7B local costuma gastar tentativas hallucinando event id
 * (e sendo corretamente rejeitado) antes de acertar, então rodando local vale
 * subir `PSYCHOLOGIST_MAX_ITERATIONS_LEVE` no engine — o knob existe pra isso.
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
  psychologistAnalyses,
} from '../src/db/schema';
import { SetModelBindingUseCase } from '../src/application/use-cases/llm/set-model-binding.use-case';
import { CreateSessionUseCase } from '../src/application/use-cases/sessions/create-session.use-case';
import { TransitionSessionUseCase } from '../src/application/use-cases/sessions/transition-session.use-case';
import { ReportSessionTerminationUseCase } from '../src/application/use-cases/sessions/report-session-termination.use-case';
import { AppendSessionEventUseCase } from '../src/application/use-cases/sessions/append-session-event.use-case';
import { GetSessionEventUseCase } from '../src/application/use-cases/sessions/get-session-event.use-case';
import { ListPsychologistAnalysesUseCase } from '../src/application/use-cases/execution/list-psychologist-analyses.use-case';
import { ListHypothesesUseCase } from '../src/application/use-cases/execution/list-hypotheses.use-case';
import { ReanalyzeSessionUseCase } from '../src/application/use-cases/execution/reanalyze-session.use-case';
import { PsychologistAnalysisRepository } from '../src/application/ports/psychologist-analysis-repository.port';
import type { PsychologistAnalysisWithCost } from '../src/domain/psychologist/psychologist-analysis.entity';
import type { PsychologistHypothesis } from '../src/domain/psychologist/psychologist-hypothesis.entity';
import { chaveDeAgente } from '../src/domain/llm/binding-scope-id';

// Modelo do tier LEVE (mais barato) e do PESADO. Sobrescrevíveis pra rodar
// contra provider pago, onde os preços já divergem sem truque nenhum.
//
// OS DOIS precisam sustentar tool call com argumento estruturado: as 3 sessões
// têm que render hipótese válida, então nenhum tier pode receber um modelo que
// não fecha o `emit_hypotheses`. Medido nesta stack: `llama3.2:1b` e
// `llama3.1:8b` NÃO chamam a tool (o 1b é a lição do ADR 0020; o 8b gastou as
// 4 iterações do tier e nunca emitiu). Sobra o `qwen2.5-coder:7b`, que é o
// mesmo motivo de ele rodar os dev agents.
//
// Só que os dois tiers precisam de PREÇOS diferentes, e `models` tem unique
// (provider, name) — não dá pra ter duas linhas de preço pro mesmo modelo.
// Daí o `qwen-psicologo-pesado`: uma CÓPIA do qwen no Ollama (mesmos pesos,
// outro nome), criada por `garantirCopiaOllama` abaixo. Assim os dois tiers
// são igualmente capazes e o custo diverge pelo preço, que é o que o critério
// de aceite mede. Num provider pago isto não é necessário.
const MODELO_LEVE = process.env.DEMO_MODEL_LEVE ?? 'qwen2.5-coder:7b';
const MODELO_PESADO =
  process.env.DEMO_MODEL_PESADO ?? 'qwen-psicologo-pesado:latest';

// Origem da cópia acima. Vazio desliga a cópia (provider pago).
const COPIA_OLLAMA_ORIGEM =
  process.env.DEMO_OLLAMA_COPY_FROM ?? 'qwen2.5-coder:7b';
const OLLAMA_HOST = process.env.OLLAMA_HOST ?? 'http://ollama:11434';

// Preços nominais em micro-USD por 1M tokens. Precisam DIFERIR bem (30x aqui,
// pra a diferença ser óbvia no relatório) e, ao mesmo tempo, caber no
// `token_budget_micros` DEFAULT de cada tier — inflar o preço até estourar o
// orçamento só provaria que o enforcement funciona, não que o custo diverge.
const PRECO_LEVE = { input: 10_000, output: 40_000 };
const PRECO_PESADO = { input: 300_000, output: 1_500_000 };

// Triagem: menos de 20 eventos -> leve (Engine.Psychologist.Triage). As
// contagens abaixo ficam de propósito longe da fronteira.
const EVENTOS_SESSAO_TRIVIAL = 6;
const EVENTOS_SESSAO_LONGA = 26;

const TIMEOUT_ANALISE_MS = Number(
  process.env.DEMO_PSICOLOGO_TIMEOUT_MS ?? 10 * 60 * 1000,
);

function log(msg: string) {
  console.log(msg);
}

function formatMicros(micros: number): string {
  return `US$ ${(micros / 1_000_000).toFixed(6)}`;
}

const falhas: string[] = [];
function exigir(condicao: boolean, mensagem: string) {
  if (condicao) {
    log(`  ✓ ${mensagem}`);
  } else {
    log(`  ✗ ${mensagem}`);
    falhas.push(mensagem);
  }
}

async function esperar(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

/**
 * Garante que o modelo do tier pesado existe no Ollama como cópia do modelo
 * capaz. Idempotente (a cópia já existir é sucesso). Só roda quando os dois
 * nomes diferem e a origem está configurada — num provider pago não faz nada.
 */
async function garantirCopiaOllama() {
  if (!COPIA_OLLAMA_ORIGEM || MODELO_PESADO === COPIA_OLLAMA_ORIGEM) return;

  const tags = await fetch(`${OLLAMA_HOST}/api/tags`);
  const { models: servidos } = (await tags.json()) as {
    models: { name: string }[];
  };
  if (servidos.some((m) => m.name === MODELO_PESADO)) {
    log(`✓ ollama já serve ${MODELO_PESADO}`);
    return;
  }

  const resp = await fetch(`${OLLAMA_HOST}/api/copy`, {
    method: 'POST',
    body: JSON.stringify({
      source: COPIA_OLLAMA_ORIGEM,
      destination: MODELO_PESADO,
    }),
  });
  if (!resp.ok) {
    throw new Error(
      `Não foi possível copiar ${COPIA_OLLAMA_ORIGEM} -> ${MODELO_PESADO} no Ollama (${resp.status}). ` +
        `Confira que a origem está baixada (\`ollama pull ${COPIA_OLLAMA_ORIGEM}\`).`,
    );
  }
  log(`✓ ollama: ${MODELO_PESADO} copiado de ${COPIA_OLLAMA_ORIGEM}`);
}

/** Conversa plausível — é o material sobre o qual o Psicólogo opina. */
function eventosDeConversa(quantidade: number) {
  const roteiro = [
    {
      type: 'chat.message',
      actor: 'user',
      texto: 'preciso de um endpoint de login',
    },
    {
      type: 'agent.response',
      actor: 'criativo',
      texto: 'qual provedor de identidade?',
    },
    { type: 'chat.message', actor: 'user', texto: 'não sei, decide você' },
    { type: 'agent.response', actor: 'criativo', texto: 'vou assumir OIDC' },
    {
      type: 'chat.message',
      actor: 'user',
      texto: 'não era isso que eu queria',
    },
    {
      type: 'agent.response',
      actor: 'criativo',
      texto: 'refazendo com sessão simples',
    },
    { type: 'chat.message', actor: 'user', texto: 'agora sim, mas está lento' },
    { type: 'tool.result', actor: 'dev-api', texto: 'testes falharam: 2 de 7' },
  ];

  return Array.from({ length: quantidade }, (_, i) => {
    const base = roteiro[i % roteiro.length];
    return {
      type: base.type,
      actor: {
        kind: base.actor === 'user' ? ('user' as const) : ('agent' as const),
        id: base.actor,
      },
      payload: { content: `${base.texto} (turno ${i + 1})` },
    };
  });
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error'],
  });
  const db = app.get<DrizzleDb>(DRIZZLE);
  const analysisRepo = app.get(PsychologistAnalysisRepository);
  const setModelBinding = app.get(SetModelBindingUseCase);
  const createSession = app.get(CreateSessionUseCase);
  const transition = app.get(TransitionSessionUseCase);
  const reportTermination = app.get(ReportSessionTerminationUseCase);
  const appendEvent = app.get(AppendSessionEventUseCase);
  const getSessionEvent = app.get(GetSessionEventUseCase);
  const listAnalyses = app.get(ListPsychologistAnalysesUseCase);
  const listHypotheses = app.get(ListHypothesesUseCase);
  const reanalyze = app.get(ReanalyzeSessionUseCase);

  const sufixo = Date.now();

  // --- projeto-cobaia ---
  const [user] = await db
    .insert(users)
    .values({
      keycloakSub: `demo-psi-${sufixo}`,
      email: `demo-psi-${sufixo}@brabo.dev`,
    })
    .returning();
  const [workspace] = await db
    .insert(workspaces)
    .values({ name: 'demo', slug: `demo-psi-${sufixo}`, createdBy: user.id })
    .returning();
  const [project] = await db
    .insert(projects)
    .values({
      workspaceId: workspace.id,
      name: 'cobaia-psicologo',
      slug: `cobaia-psi-${sufixo}`,
      createdBy: user.id,
    })
    .returning();
  await db
    .insert(projectMembers)
    .values({ projectId: project.id, userId: user.id, role: 'owner' });
  log(`✓ projeto-cobaia: ${project.id}`);

  // --- bindings por tier, com preços que divergem ---
  async function prepararModelo(
    nome: string,
    preco: { input: number; output: number },
  ) {
    // Upsert em vez de exigir seed: `models` não tem endpoint HTTP de
    // administração (decisão da Fase 1), e o modelo capaz que o tier pesado
    // usa não está no seed. O que importa é existir no catálogo com um preço
    // — quem serve é o Ollama do compose.
    const [existente] = await db
      .select()
      .from(models)
      .where(and(eq(models.provider, 'ollama'), eq(models.name, nome)));

    const modelo =
      existente ??
      (
        await db
          .insert(models)
          .values({
            provider: 'ollama',
            name: nome,
            displayName: `${nome} (local)`,
          })
          .returning()
      )[0];

    await db
      .update(models)
      .set({
        inputPricePerMillionMicros: preco.input,
        outputPricePerMillionMicros: preco.output,
      })
      .where(eq(models.id, modelo.id));
    return modelo;
  }

  await garantirCopiaOllama();

  const modeloLeve = await prepararModelo(MODELO_LEVE, PRECO_LEVE);
  const modeloPesado = await prepararModelo(MODELO_PESADO, PRECO_PESADO);

  await setModelBinding.execute(
    'agent',
    chaveDeAgente(project.id, 'psicologo-leve'),
    modeloLeve.id,
    user.id,
  );
  await setModelBinding.execute(
    'agent',
    chaveDeAgente(project.id, 'psicologo'),
    modeloPesado.id,
    user.id,
  );
  await setModelBinding.execute(
    'project',
    project.id,
    modeloPesado.id,
    user.id,
  );
  log(
    `✓ triagem leve -> ollama/${MODELO_LEVE} (${formatMicros(PRECO_LEVE.input)}/1M in)`,
  );
  log(
    `✓ triagem pesada -> ollama/${MODELO_PESADO} (${formatMicros(PRECO_PESADO.input)}/1M in)`,
  );

  // --- as 3 sessões ---
  async function semearSessao(quantidadeEventos: number) {
    const session = await createSession.execute(project.id, user.id, {
      kind: 'criativa',
    });
    await transition.execute(project.id, session.id, 'active');
    for (const evento of eventosDeConversa(quantidadeEventos)) {
      await appendEvent.execute(project.id, session.id, evento);
    }
    return session;
  }

  log('\n--- encerrando 3 sessões ---');

  // 1) NORMAL, log curto -> triagem leve.
  const sessaoNormal = await semearSessao(EVENTOS_SESSAO_TRIVIAL);
  await transition.execute(project.id, sessaoNormal.id, 'closing');
  await transition.execute(project.id, sessaoNormal.id, 'closed');
  log(`✓ normal   ${sessaoNormal.id} (${EVENTOS_SESSAO_TRIVIAL} eventos)`);

  // 2) KILL -> closed_abnormally, causa `kill`.
  const sessaoKill = await semearSessao(EVENTOS_SESSAO_TRIVIAL);
  await reportTermination.execute(
    project.id,
    sessaoKill.id,
    'closed_abnormally',
    'killed',
  );
  log(`✓ kill     ${sessaoKill.id} (${EVENTOS_SESSAO_TRIVIAL} eventos)`);

  // 3) ERRO com log longo -> closed_abnormally, causa `crash`, triagem pesada.
  const sessaoErro = await semearSessao(EVENTOS_SESSAO_LONGA);
  await reportTermination.execute(
    project.id,
    sessaoErro.id,
    'closed_abnormally',
    '** (RuntimeError) conexão com o provider caiu no meio do turno',
  );
  log(`✓ erro     ${sessaoErro.id} (${EVENTOS_SESSAO_LONGA} eventos)`);

  const esperadas = [sessaoNormal.id, sessaoKill.id, sessaoErro.id];

  // --- espera as análises (engine: outbox -> Oban -> ToolLoop -> api) ---
  log('\n--- aguardando o Psicólogo (pode levar minutos com modelo local) ---');
  const limite = Date.now() + TIMEOUT_ANALISE_MS;
  let analises: PsychologistAnalysisWithCost[] = [];
  while (Date.now() < limite) {
    analises = await listAnalyses.execute(project.id);
    const prontas = esperadas.filter((id) =>
      analises.some((a) => a.sessionId === id),
    );
    log(`  ${prontas.length}/3 sessões analisadas`);
    if (prontas.length === 3) break;
    await esperar(10_000);
  }

  const hipoteses = await listHypotheses.execute(project.id);

  // --- verificação do critério de aceite ---
  log('\n--- critério de aceite ---');

  exigir(
    analises.length === 3,
    `3 análises current (obtidas: ${analises.length})`,
  );

  const porSessao = new Map(analises.map((a) => [a.sessionId, a]));
  const hipotesesPorSessao = new Map<string, PsychologistHypothesis[]>();
  for (const h of hipoteses) {
    hipotesesPorSessao.set(h.sessionId, [
      ...(hipotesesPorSessao.get(h.sessionId) ?? []),
      h,
    ]);
  }

  const casos: {
    nome: string;
    sessionId: string;
    tier: 'leve' | 'pesada';
    exigeTermino: boolean;
  }[] = [
    {
      nome: 'normal',
      sessionId: sessaoNormal.id,
      tier: 'leve',
      exigeTermino: false,
    },
    {
      nome: 'kill',
      sessionId: sessaoKill.id,
      tier: 'leve',
      exigeTermino: true,
    },
    {
      nome: 'erro',
      sessionId: sessaoErro.id,
      tier: 'pesada',
      exigeTermino: true,
    },
  ];

  for (const caso of casos) {
    log(`\n[${caso.nome}] sessão ${caso.sessionId}`);
    const analise = porSessao.get(caso.sessionId);
    exigir(!!analise, 'tem análise current');
    if (!analise) continue;

    exigir(
      analise.tier === caso.tier,
      `triagem ${caso.tier} (obtida: ${analise.tier}, ${analise.eventCountAtAnalysis} eventos)`,
    );

    const doCaso = hipotesesPorSessao.get(caso.sessionId) ?? [];
    exigir(doCaso.length > 0, `rendeu hipótese (${doCaso.length})`);

    // Evidência NAVEGÁVEL: resolve pelo mesmo endpoint por id que a UI usa.
    let evidencias = 0;
    let naoResolvidas = 0;
    for (const h of doCaso) {
      exigir(
        h.evidenceEventIds.length > 0,
        `hipótese ${h.id.slice(0, 8)} tem evidência`,
      );
      for (const eventId of h.evidenceEventIds) {
        evidencias += 1;
        try {
          await getSessionEvent.execute(project.id, caso.sessionId, eventId);
        } catch {
          naoResolvidas += 1;
          log(`    ! evidência ${eventId} não resolve nesta sessão`);
        }
      }
    }
    exigir(
      evidencias > 0 && naoResolvidas === 0,
      `todas as ${evidencias} evidência(s) resolvem num evento real da sessão`,
    );

    if (caso.exigeTermino) {
      exigir(
        doCaso.some((h) => h.terminationAnalysis != null),
        'término anormal trouxe terminationAnalysis',
      );
      const comAnalise = doCaso.find((h) => h.terminationAnalysis);
      if (comAnalise?.terminationAnalysis) {
        log(
          `    causa relatada: "${comAnalise.terminationAnalysis.causa}" · estado: "${comAnalise.terminationAnalysis.estadoDaSessao}"`,
        );
      }
    }

    log(`    custo: ${formatMicros(analise.costMicros)}`);
  }

  // --- custos distintos entre os tiers ---
  log('\n[metering] custos por triagem');
  const leves = analises.filter((a) => a.tier === 'leve');
  const pesadas = analises.filter((a) => a.tier === 'pesada');
  const custoLeve = leves.reduce((acc, a) => acc + a.costMicros, 0);
  const custoPesada = pesadas.reduce((acc, a) => acc + a.costMicros, 0);

  log(`  leve   (${leves.length} análise(s)): ${formatMicros(custoLeve)}`);
  log(`  pesada (${pesadas.length} análise(s)): ${formatMicros(custoPesada)}`);
  exigir(custoPesada > 0, 'triagem pesada tem custo registrado no metering');
  exigir(
    custoLeve < custoPesada,
    `custo da leve abaixo do da pesada (${formatMicros(custoLeve)} < ${formatMicros(custoPesada)})`,
  );

  // --- reprocessamento explícito supersede sem apagar ---
  log('\n[reanálise] reprocessamento explícito da sessão normal');
  const anterior = porSessao.get(sessaoNormal.id);
  if (!anterior) {
    exigir(false, 'sessão normal tinha análise pra reprocessar');
  } else {
    await reanalyze.execute(project.id, sessaoNormal.id);

    const limiteReanalise = Date.now() + TIMEOUT_ANALISE_MS;
    let nova = await analysisRepo.findCurrentBySession(sessaoNormal.id);
    while (Date.now() < limiteReanalise && nova?.id === anterior.id) {
      await esperar(10_000);
      nova = await analysisRepo.findCurrentBySession(sessaoNormal.id);
    }

    exigir(
      !!nova && nova.id !== anterior.id,
      'nasceu uma análise current nova',
    );
    exigir(
      nova?.supersedes === anterior.id,
      'a nova aponta pra anterior via supersedes',
    );

    // Histórico: a anterior continua no banco, marcada e datada. Leitura
    // direta da tabela de propósito — o repositório só expõe a current, e o
    // que interessa aqui é justamente a linha que SAIU de current.
    const [antigaNoBanco] = await db
      .select()
      .from(psychologistAnalyses)
      .where(eq(psychologistAnalyses.id, anterior.id));
    exigir(
      antigaNoBanco?.superseded === true,
      'a análise anterior segue no banco, marcada superseded (nunca apagada)',
    );
    exigir(
      antigaNoBanco?.supersededAt != null,
      'a substituição está datada em superseded_at',
    );
  }

  // --- desfecho ---
  log('\n=== resultado ===');
  if (falhas.length === 0) {
    log('✓ critério de aceite da Fase 4b (sessão 1) ATENDIDO');
    log(`  projeto: ${project.id} — abra a seção Insights pra navegar`);
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
