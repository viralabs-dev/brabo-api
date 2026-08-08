/**
 * A validação REAL da FASE 13b — GitHub remoto, dev agent real, gates por LLM.
 *
 * Uso: pnpm --filter api validacao:real -- --repo <owner/repo> [--ate <fase>]
 *
 * ## O que ela prova que a da Fase 12 NÃO provava
 *
 * A `validacao-fase-12.ts` declara os próprios limites com todas as letras:
 * roda no `LocalGitProvider`, com o `NoopDevAgent`, e com o veredito de gate
 * escrito pelo próprio script. Ela existe para provar a CADEIA (adoção →
 * promoção → reagendamento → gate → trava de merge) sem depender de rede nem
 * de julgamento de modelo.
 *
 * Esta aqui troca exatamente as três coisas que aquela deixou de fora:
 *
 *   * **GitHub remoto** em vez de bare local — `getRepo` de verdade, PR de
 *     verdade, rede de verdade;
 *   * **dev agent real** em vez do Noop — LLM escrevendo código;
 *   * **gates por LLM** em vez de veredito escrito pelo script.
 *
 * O que ela NÃO faz continua sendo o mesmo, e por desenho: **merge**. Merge em
 * branch protegida é decisão do usuário ([RN-014]), e nenhuma automação do
 * produto o executa.
 *
 * ## PRÉ-REQUISITO: rodar DE DENTRO do container da api
 *
 * Não é detalhe de conveniência. A política de permissões é um ARQUIVO em
 * `PROJECT_WORKSPACES_ROOT`, que api e engine compartilham por volume. Rodando
 * pelo host, a raiz cai no default (`/tmp/brabo-project-workspaces`) e o
 * `permissions.json` nasce num filesystem que o engine não enxerga — a política
 * simplesmente não existe para quem decide, e todo comando fica pendente.
 *
 * É a mesma armadilha que a `validacao-fase-12` documenta sobre o repositório
 * cobaia, e ela reaparece aqui por outro caminho.
 *
 * ## O owner é REAL, não um usuário descartável
 *
 * A `validacao-fase-12` cria usuário e workspace próprios porque não gasta
 * token nem toca em rede. Aqui não dá: pela **RN-058**, a chave que o agente
 * gasta é a do OWNER do workspace, lida do banco. Um usuário novo não tem
 * credencial nenhuma, e a execução morreria no primeiro turno.
 *
 * Por isso o pré-voo escolhe o usuário que tem AS DUAS credenciais — git e
 * LLM — e falha cedo, antes de criar qualquer coisa, se não houver nenhum.
 * Escolher pela credencial de git sozinha pegava um usuário de demo sem chave
 * de modelo, e o erro só apareceria no primeiro turno pago.
 *
 * ## Fases
 *
 * `--ate` para em qualquer uma delas. Existe porque as fases têm custos
 * MUITO diferentes: `adocao` é grátis, `execucao` gasta dinheiro de verdade.
 * Rodar a barata primeiro, sozinha, é o que evita descobrir um erro de
 * configuração depois de já ter pago por ele.
 *
 *   adocao    — projeto + adoção remota, SEM decidir o plano   (grátis)
 *
 * `--plano aprovar|como-esta` decide o que fazer com a divergência. Não é
 * simétrico: "como está" é o certo para repositório que já tem convenção
 * própria (o caso da RN-045), e "aprovar" é o certo para repositório VAZIO —
 * onde "como está" não deixa branch nem commit, e o dev agent não teria de
 * onde partir.
 *   backlog   — story criada e promovida por você            (grátis)
 *   execucao  — dev agent real → PR remota → gates por LLM   (PAGO)
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
  models,
  projectMembers,
  projectRepositories,
  projects,
  proposedActions,
  repoBootstraps,
  sessionEvents,
  userCredentials,
  users,
  workspaces,
} from '../src/db/schema';
import { AdoptRepositoryUseCase } from '../src/application/use-cases/git/adopt-repository.use-case';
import { DecideBootstrapPlanUseCase } from '../src/application/use-cases/git/decide-bootstrap-plan.use-case';
import { AcknowledgeProtectionFailureUseCase } from '../src/application/use-cases/git/acknowledge-protection-failure.use-case';
import { AppendSessionEventUseCase } from '../src/application/use-cases/sessions/append-session-event.use-case';
import { CreateStoryUseCase } from '../src/application/use-cases/backlog/create-story.use-case';
import { PromoteStoriesUseCase } from '../src/application/use-cases/backlog/promote-stories.use-case';
import { ActivateExecutionUseCase } from '../src/application/use-cases/execution/activate-execution.use-case';
import { RequestParallelizationUseCase } from '../src/application/use-cases/execution/request-parallelization.use-case';
import { SetModelBindingUseCase } from '../src/application/use-cases/llm/set-model-binding.use-case';
import { PermissionsFileStore } from '../src/application/ports/permissions-file-store.port';
import { SessionRepository } from '../src/application/ports/session-repository.port';
import { CreateHandoffUseCase } from '../src/application/use-cases/agents/create-handoff.use-case';
import { AcceptHandoffUseCase } from '../src/application/use-cases/agents/accept-handoff.use-case';
import { OfferInfraHandoffUseCase } from '../src/application/use-cases/agents/offer-infra-handoff.use-case';
import { HandoffRepository } from '../src/application/ports/handoff-repository.port';
import { ModuleMapRepository } from '../src/application/ports/module-map-repository.port';
import {
  EpicRepository,
  StoryRepository,
  TaskRepository,
} from '../src/application/ports/backlog-repository.port';

type Fase = 'adocao' | 'backlog' | 'dev-lead' | 'execucao';
const FASES: Fase[] = ['adocao', 'backlog', 'dev-lead', 'execucao'];

type Plano = 'aprovar' | 'como-esta';

interface Opcoes {
  repo: string;
  ate: Fase;
  plano: Plano;
  /** Modelo de API do dev agent e dos gates. Nunca local — ver ADR 0020. */
  modelo: string;
  /** Quantas histórias no MESMO módulo. Cada uma a mais é um ciclo PAGO. */
  historias: number;
  /** Quantos módulos no module_map. Com 2, a ativação já sobe 2 agentes. */
  modulos: number;
}

function lerOpcoes(): Opcoes {
  const args = process.argv.slice(2);
  const repo = args[args.indexOf('--repo') + 1];

  if (!args.includes('--repo') || !repo || repo.startsWith('--')) {
    console.error(
      'uso: validacao-real.ts --repo <owner/repo> [--ate adocao|backlog|dev-lead|execucao]',
    );
    process.exit(2);
  }

  const ateArg = args.includes('--ate')
    ? args[args.indexOf('--ate') + 1]
    : null;
  if (ateArg != null && !FASES.includes(ateArg as Fase)) {
    console.error(`--ate inválido: ${ateArg} (use ${FASES.join(' | ')})`);
    process.exit(2);
  }

  // Quantas histórias no MESMO módulo. Default 1 — cada task a mais é um
  // ciclo de dev+gates a mais, PAGO. Com 2+ o Dev Lead tem motivo real para
  // pedir mais de um agente, que é o que coloca o teto da RN-083 à prova.
  const historias = args.includes('--historias')
    ? Number(args[args.indexOf('--historias') + 1])
    : 1;
  if (!Number.isInteger(historias) || historias < 1) {
    console.error('--historias precisa ser inteiro >= 1');
    process.exit(2);
  }

  const modulos = args.includes('--modulos')
    ? Number(args[args.indexOf('--modulos') + 1])
    : 1;
  if (!Number.isInteger(modulos) || modulos < 1 || modulos > 2) {
    console.error('--modulos precisa ser 1 ou 2');
    process.exit(2);
  }

  const planoArg = args.includes('--plano')
    ? args[args.indexOf('--plano') + 1]
    : null;
  if (planoArg != null && planoArg !== 'aprovar' && planoArg !== 'como-esta') {
    console.error(`--plano inválido: ${planoArg} (use aprovar | como-esta)`);
    process.exit(2);
  }

  const modeloArg = args.includes('--modelo')
    ? args[args.indexOf('--modelo') + 1]
    : null;

  return {
    repo,
    ate: (ateArg as Fase) ?? 'execucao',
    plano: (planoArg as Plano) ?? 'como-esta',
    modelo: modeloArg ?? 'openai/gpt-5-mini',
    historias,
    modulos,
  };
}

function log(msg: string) {
  console.log(msg);
}

function assertar(condicao: boolean, mensagem: string): asserts condicao {
  if (!condicao) throw new Error(`CRITÉRIO NÃO FECHOU: ${mensagem}`);
}

const MODULOS = [
  {
    name: 'api',
    stack: 'NestJS',
    responsibility: 'regras de negócio e endpoints',
    dependsOn: [],
  },
];

/**
 * O segundo módulo, com `--modulos 2`.
 *
 * Existe para o Dev Lead ter motivo REAL de pedir mais de um agente: duas
 * histórias no MESMO módulo ele recusa paralelizar, e com razão — "esbarrariam
 * nos mesmos arquivos". Trabalho independente é outra conversa.
 *
 * `dependsOn: []` de propósito: dependência entre os dois daria ao lead um
 * argumento legítimo para serializar, e o que se quer medir aqui é a decisão
 * dele quando o paralelismo FAZ sentido.
 */
const MODULO_EXTRA = {
  name: 'web',
  stack: 'React',
  responsibility: 'interface do usuário',
  dependsOn: [],
};

// Tetos generosos, e por motivos diferentes. O dev real escreve código com
// LLM e faz três chamadas de rede ao GitHub (commit, push, PR); os gates são
// dois agentes lendo um diff. Um teto curto aqui não mede nada — só transforma
// lentidão em falha, e desperdiça o que já foi PAGO até o ponto do timeout.
const TIMEOUT_DEV_MS = 15 * 60_000;
const TIMEOUT_GATES_MS = 15 * 60_000;

/**
 * Espera uma condição aparecer no banco.
 *
 * Sonda em vez de assinar evento de propósito: o que se está validando é o
 * ESTADO durável que sobra depois, e não uma notificação em memória — se a
 * cadeia funcionar só por broadcast, ela não passa aqui, que é justamente o
 * tipo de defeito que esta fase existe para pegar.
 */
async function esperar<T>(
  rotulo: string,
  fn: () => Promise<T | null>,
  timeoutMs: number,
): Promise<T> {
  const limite = Date.now() + timeoutMs;
  let ultimoAviso = 0;

  for (;;) {
    const valor = await fn();
    if (valor) return valor;

    if (Date.now() > limite) {
      throw new Error(
        `timeout (${Math.round(timeoutMs / 60_000)}min) esperando: ${rotulo}`,
      );
    }

    // Um sinal de vida a cada minuto: sem ele, uma espera de 15 minutos é
    // indistinguível de um script travado, e a tentação é matá-lo no meio —
    // justamente o que descartaria o gasto já feito.
    const decorrido = Date.now() - (limite - timeoutMs);
    if (decorrido - ultimoAviso >= 60_000) {
      ultimoAviso = decorrido;
      log(`  … ${Math.round(decorrido / 1000)}s esperando ${rotulo}`);
    }

    await new Promise((r) => setTimeout(r, 2000));
  }
}

async function main() {
  const {
  repo,
  ate,
  plano,
  modelo: modeloAlvo,
  historias,
  modulos,
} = lerOpcoes();
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error'],
  });
  const db = app.get<DrizzleDb>(DRIZZLE);

  // ---------------- pré-voo: as credenciais existem? ----------------------
  //
  // ANTES de criar qualquer coisa. Descobrir que falta credencial depois de
  // montar projeto e sessão deixa lixo no banco e, na fase paga, depois de
  // já ter gasto.
  log('--- 0. pré-voo: credenciais do owner ---');

  const credenciais = await db.select().from(userCredentials);

  // Quem serve é quem tem AS DUAS: git para adotar e abrir PR, LLM para os
  // agentes gastarem (RN-058). Pegar a primeira credencial de git escolhia um
  // usuário de demo que nunca teve chave de modelo — e o erro só apareceria
  // no primeiro turno, depois de o projeto já existir.
  const providersPorUsuario = new Map<string, Set<string>>();
  for (const c of credenciais) {
    const atual = providersPorUsuario.get(c.userId) ?? new Set<string>();
    atual.add(c.provider);
    providersPorUsuario.set(c.userId, atual);
  }

  const candidatos = [...providersPorUsuario.entries()].filter(
    ([, providers]) =>
      providers.has('github') && [...providers].some((p) => p !== 'github'),
  );

  assertar(
    candidatos.length > 0,
    'nenhum usuário tem credencial de git E de LLM ao mesmo tempo — ' +
      'a adoção remota precisa da primeira, e os agentes da segunda (RN-058)',
  );

  const ownerId = candidatos[0][0];
  const [owner] = await db.select().from(users).where(eq(users.id, ownerId));
  assertar(owner != null, `usuário ${ownerId} da credencial de git não existe`);

  const [workspace] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.createdBy, owner.id));
  assertar(
    workspace != null,
    `o dono da credencial (${owner.email}) não criou workspace nenhum`,
  );

  const deLlm = credenciais.filter(
    (c) => c.userId === owner.id && c.provider !== 'github',
  );
  assertar(
    deLlm.length > 0,
    `o owner ${owner.email} não tem credencial de LLM — pela RN-058 é a chave DELE que os agentes gastam`,
  );

  log(`✓ owner: ${owner.email} · workspace: ${workspace.name}`);
  log(`✓ credenciais: github + ${deLlm.map((c) => c.provider).join(', ')}`);

  // ---------------- 1. projeto e adoção remota ----------------------------
  log('\n--- 1. adotar um repositório REMOTO que já existe ---');

  const sufixo = Date.now();
  const [project] = await db
    .insert(projects)
    .values({
      workspaceId: workspace.id,
      name: 'validacao-real',
      slug: `validacao-real-${sufixo}`,
      createdBy: owner.id,
    })
    .returning();
  await db
    .insert(projectMembers)
    .values({ projectId: project.id, userId: owner.id, role: 'owner' });

  log(`projeto: ${project.id}`);
  assertar(
    project.storyPromotion === 'manual',
    `projeto novo nasceu em "${project.storyPromotion}"; o default é "manual"`,
  );
  log('✓ promoção MANUAL por default (RN-048)');

  const adocao = await app
    .get(AdoptRepositoryUseCase)
    .execute(project.id, owner.id, { provider: 'github', externalId: repo });

  assertar(
    adocao.repository.origin === 'adopted',
    `origin deveria ser "adopted", veio "${adocao.repository.origin}"`,
  );
  log(
    `✓ adotado do GitHub: ${repo} · origin=${adocao.repository.origin} · branch padrão=${adocao.repository.defaultBranch ?? '(nenhuma — repo vazio)'}`,
  );

  log(`✓ plano: ${adocao.plan.steps.length} mutação(ões) que o Brabo FARIA`);
  for (const passo of adocao.plan.steps) {
    log(`    ${passo.step.padEnd(24)} ${passo.actionType}`);
  }
  for (const d of adocao.plan.diagnostics) {
    log(`    diagnóstico: ${d.kind} ${JSON.stringify(d.detail)}`);
  }

  const bootstrapAntes = await db
    .select()
    .from(repoBootstraps)
    .where(eq(repoBootstraps.projectId, project.id));
  assertar(
    bootstrapAntes.every((b) => b.planDecision === null),
    'a decisão do plano deveria estar NULA antes de o usuário decidir (RN-045)',
  );
  log('✓ decisão NULA — nada foi alterado no repositório remoto (RN-045)');

  const [repoRow] = await db
    .select()
    .from(projectRepositories)
    .where(eq(projectRepositories.projectId, project.id));
  assertar(
    repoRow?.origin === 'adopted' && repoRow.externalId === repo,
    'a linha de repositório não reflete a adoção remota',
  );
  log('✓ ZERO seed manual: as linhas nasceram do caso de uso');

  if (ate === 'adocao') {
    log(
      `\n[validacao-real] parou em "adocao" como pedido.\n` +
        `projeto: ${project.id}\n` +
        `plano gerado em: ${String(adocao.plan.generatedAt)}\n` +
        `\nA decisão do plano NÃO foi tomada — o repositório remoto está intocado.`,
    );
    await app.close();
    return;
  }

  // A partir daqui o Brabo ESCREVE no repositório do usuário.
  //
  // A escolha importa e não é simétrica. "Como está" faz sentido para um repo
  // que JÁ TEM convenção própria — o caso que a RN-045 protege, e o que a
  // validação da Fase 12 exercitou. Num repositório VAZIO ele não deixa nada:
  // sem branch e sem commit, o dev agent não tem de onde partir, e a fase
  // paga morreria montando o worktree.
  const decisao = app.get(DecideBootstrapPlanUseCase);
  if (plano === 'aprovar') {
    try {
      await decisao.approve(project.id, owner.id, {
        planGeneratedAt: adocao.plan.generatedAt,
      });
      log('✓ plano APROVADO por você — o Brabo escreve no repositório remoto');
    } catch (erro) {
      // `protect_branches` falha em repo PRIVADO no plano gratuito do GitHub,
      // e é o único passo cuja falha deixa um repositório utilizável: o repo
      // existe, os arquivos foram commitados, as branches foram criadas. A
      // RN-078 existe exatamente para isto — reconhecer e seguir.
      //
      // Reconhecer aqui não é contornar o erro: é exercitar, contra um remoto
      // de verdade, a saída que a Fase D construiu e que nunca tinha rodado
      // fora de teste.
      const msg = String(erro);
      const daProtecao =
        msg.includes('branch-protection') || msg.includes('GitHub Pro');
      if (!daProtecao) throw erro;

      log(`  bootstrap parou na proteção de branches: ${msg.split(' - ')[0]}`);
      await app
        .get(AcknowledgeProtectionFailureUseCase)
        .execute(project.id, owner.id);
      log(
        '✓ falha de proteção RECONHECIDA por você (RN-078) — o projeto segue utilizável',
      );
      log(
        '  a trava de merge do produto NÃO depende disso: ela é aplicada em decide.ts (RN-006)',
      );
    }
  } else {
    await decisao.adoptAsIs(project.id, owner.id, {
      planGeneratedAt: adocao.plan.generatedAt,
    });
    log('✓ adotado COMO ESTÁ — o template não foi forçado sobre o repo remoto');
  }

  // ---------------- 2. backlog: UMA story, promovida por você -------------
  log('\n--- 2. backlog: UMA story, e nada pegável antes de você decidir ---');

  const sessionRepo = app.get(SessionRepository);
  const moduleMaps = app.get(ModuleMapRepository);
  const epics = app.get(EpicRepository);
  const stories = app.get(StoryRepository);
  const tasks = app.get(TaskRepository);

  const sessaoBacklog = await sessionRepo.create({
    projectId: project.id,
    createdBy: owner.id,
  });
  await moduleMaps.create({
    projectId: project.id,
    sessionId: sessaoBacklog.id,
    modules: modulos === 2 ? [...MODULOS, MODULO_EXTRA] : MODULOS,
    version: 1,
  });

  const epic = await epics.create({
    projectId: project.id,
    sessionId: sessaoBacklog.id,
    title: 'Saudação pública',
  });

  // A regra tem de existir no event log: `CreateStoryUseCase` valida cada
  // `businessRuleId` contra um `artifact.business_rule` REAL. Emitida pelo
  // caso de uso, não inserida à mão — `seq` é denso por sessão (RN-002).
  const eventoRegra = await app
    .get(AppendSessionEventUseCase)
    .execute(project.id, sessaoBacklog.id, {
      type: 'artifact.business_rule',
      actor: { kind: 'agent', id: 'criativo' },
      payload: {
        title: 'Saudação sem autenticação',
        description: 'a rota de saudação responde sem exigir login',
        origin: [1],
      },
    });

  // UMA story e UMA task, de propósito: a 13b pede "promoção manual de UMA
  // story", e cada task a mais é um ciclo de dev+gates a mais, PAGO. O
  // reagendamento entre tasks já está provado pela validação da Fase 12.
  const story = await app
    .get(CreateStoryUseCase)
    .execute(project.id, sessaoBacklog.id, {
      epicId: epic.id,
      title: 'Rota pública de saudação',
      rf: ['GET /saudacao responde 200 com uma mensagem'],
      dod: ['teste do caminho feliz'],
      dor: ['regra de negócio definida'],
      businessRuleIds: [eventoRegra.id],
    });

  await stories.updateModules(story.id, ['api']);
  await tasks.create({ storyId: story.id, title: 'Expor GET /saudacao' });

  // As extras vão no MESMO módulo de propósito: é isso que dá ao Dev Lead
  // motivo para pedir mais de um agente ali, em vez de espalhar um por módulo.
  const extras: { id: string }[] = [];
  for (let i = 2; i <= historias; i++) {
    const extra = await app
      .get(CreateStoryUseCase)
      .execute(project.id, sessaoBacklog.id, {
        epicId: epic.id,
        title: `Rota pública de status ${i}`,
        rf: [`GET /status${i} responde 200 com o estado do serviço`],
        dod: ['teste do caminho feliz'],
        dor: ['regra de negócio definida'],
        businessRuleIds: [eventoRegra.id],
      });
    // Com dois módulos, a extra vai para o SEGUNDO: é o que torna o trabalho
    // independente e dá ao lead motivo para pedir dois agentes.
    await stories.updateModules(extra.id, [modulos === 2 ? 'web' : 'api']);
    await tasks.create({ storyId: extra.id, title: `Expor GET /status${i}` });
    extras.push(extra);
  }
  if (extras.length > 0) {
    log(`✓ ${extras.length} história(s) extra(s) no MESMO módulo (api)`);
  }

  assertar(
    story.status === 'draft' && story.proposedReady,
    `story deveria ficar draft e proposta; veio status="${story.status}" proposta=${String(story.proposedReady)}`,
  );
  log('✓ story ficou DRAFT, proposta a você (não promovida sozinha)');

  const claimAntes = await tasks.claimNext(project.id, 'api', 'dev-api-teste');
  assertar(
    claimAntes === null,
    'uma task foi reivindicável ANTES da promoção — o passo humano não travou nada',
  );
  log('✓ claimNext devolve NULL antes da sua decisão');

  const resultado = await app
    .get(PromoteStoriesUseCase)
    .execute(project.id, [story.id, ...extras.map((e) => e.id)], owner.id);
  assertar(
    resultado.promoted.length === historias && resultado.failed.length === 0,
    `promoção falhou: ${JSON.stringify(resultado.failed)}`,
  );

  const promocao = await db
    .select()
    .from(sessionEvents)
    .where(
      and(
        eq(sessionEvents.sessionId, sessaoBacklog.id),
        eq(sessionEvents.type, 'backlog.story_transitioned'),
      ),
    );
  assertar(
    promocao[0]?.actorKind === 'user' && promocao[0].actorId === owner.id,
    `o evento registrou "${promocao[0]?.actorKind}/${promocao[0]?.actorId}" e não você`,
  );
  log('✓ promovida por AÇÃO SUA — e o event log registra isso');

  // -------------- 2b. o Dev Lead recebe e PLANEJA (FASE 14d) --------------
  //
  // Fase própria, com custo próprio: um turno de LLM do Arquiteto (fechamento)
  // e um do Dev Lead (o plano). Separada da execução pelo mesmo critério que
  // separa as outras — a barata roda primeiro, e é assim que erro de
  // configuração aparece antes de custar o preço da execução inteira.
  async function faseDevLead() {
    log('\n--- 2b. o Dev Lead recebe o handoff e PLANEJA (GASTA POUCO) ---');

    const handoffs = app.get(HandoffRepository);

    // O Arquiteto precisa estar DE PÉ: quem oferece os dois handoffs é ele, e
    // `offer_*_handoff` é um GenServer.call no processo dele.
    //
    // O handoff PO → Arquiteto é SEMEADO, como o module_map logo acima: esta
    // fase testa o elo Arquiteto → Dev Lead, e rodar Criativo e PO só para
    // chegar aqui custaria vários turnos sem provar nada de novo. O que NÃO é
    // semeado é o que está sob teste — os dois handoffs que saem daqui.
    const paraArquiteto = await app
      .get(CreateHandoffUseCase)
      .execute(project.id, sessaoBacklog.id, {
        fromAgent: 'po',
        toAgent: 'arquiteto',
      });

    // Aceitar já ATIVA o agente (AcceptHandoffUseCase chama ActivateAgent).
    await app
      .get(AcceptHandoffUseCase)
      .execute(project.id, sessaoBacklog.id, paraArquiteto.id, owner.id);
    log('✓ Arquiteto de pé (handoff PO→Arquiteto semeado)');

    // A confirmação de arquitetura pronta: UMA ação, DOIS handoffs.
    await app
      .get(OfferInfraHandoffUseCase)
      .execute(project.id, sessaoBacklog.id, owner.id);

    const ofertados = await esperar(
      'os handoffs para infra E dev-lead',
      async () => {
        const todos = await handoffs.findBySession(sessaoBacklog.id);
        const alvos = todos.map((h) => h.toAgent);
        return alvos.includes('dev-lead') && alvos.includes('infra')
          ? todos
          : null;
      },
      60_000,
    );
    log(`✓ ${ofertados.length} handoff(s) ofertado(s): infra e dev-lead`);

    const paraDev = ofertados.find((h) => h.toAgent === 'dev-lead')!;
    await app
      .get(AcceptHandoffUseCase)
      .execute(project.id, sessaoBacklog.id, paraDev.id, owner.id);
    log('✓ handoff do Dev Lead aceito — ele foi ativado');

    // O plano é o desfecho observável do item 5: sem ele, o agente subiu e não
    // fez o que existe para fazer.
    const plano = await esperar(
      'o plano do Dev Lead (execution.plan_proposed)',
      async () => {
        const [ev] = await db
          .select()
          .from(sessionEvents)
          .where(
            and(
              eq(sessionEvents.sessionId, sessaoBacklog.id),
              eq(sessionEvents.type, 'execution.plan_proposed'),
            ),
          );
        return ev ?? null;
      },
      300_000,
    );

    const payload = plano.payload as {
      totalAgentes?: number;
      resumo?: string;
      modulos?: { modulo: string; agentes: number; porque: string }[];
    };

    assertar(
      plano.actorId === 'dev-lead' && plano.actorKind === 'agent',
      `o plano veio de "${plano.actorKind}/${plano.actorId}" e não do dev-lead`,
    );
    assertar(
      (payload.modulos?.length ?? 0) > 0,
      'o plano não trouxe módulo nenhum',
    );
    assertar(
      payload.modulos!.every((m) => (m.porque ?? '').trim().length > 0),
      'algum módulo veio sem justificativa — é o que você lê para decidir',
    );

    log(
      `✓ PLANO: ${payload.totalAgentes} agente(s) em ` +
        `${payload.modulos!.length} módulo(s) — "${payload.resumo}"`,
    );
    for (const m of payload.modulos!) {
      log(`    ${m.modulo}: ${m.agentes} — ${m.porque}`);
    }
  }

  if (ate === 'backlog') {
    log(
      `\n[validacao-real] parou em "backlog" como pedido. Nada foi gasto.\n` +
        `projeto: ${project.id}\nstory: ${story.id}`,
    );
    await app.close();
    return;
  }

  await faseDevLead();

  if (ate === 'dev-lead') {
    log(
      `\n[validacao-real] parou em "dev-lead" como pedido.\n` +
        `projeto: ${project.id}\nsessão: ${sessaoBacklog.id}`,
    );
    await app.close();
    return;
  }

  // ---------------- 3. execução PAGA: dev real + gates por LLM ------------
  log(
    '\n--- 3. execução com dev agent REAL e gates por LLM (A PARTIR DAQUI GASTA) ---',
  );

  // O modelo do projeto, ANTES de ativar. Sem isto a cascata pousa no default
  // do workspace, que aqui é `llama3.2:1b` — e a 13b proíbe explicitamente 7B
  // local no passo semântico (ADR 0020). A regra vira ASSERÇÃO em vez de
  // confiança: se o resolvido for local, o script para antes de gastar.
  const [modelo] = await db
    .select()
    .from(models)
    .where(and(eq(models.provider, 'openrouter'), eq(models.name, modeloAlvo)));

  assertar(
    modelo != null,
    `modelo "${modeloAlvo}" não está no catálogo — rode o sync, ou passe --modelo`,
  );
  assertar(
    modelo.supportsToolCalling,
    `"${modeloAlvo}" não declara tool calling; o dev agent não funciona sem isso`,
  );

  await app
    .get(SetModelBindingUseCase)
    .execute('project', project.id, modelo.id, owner.id);
  log(`✓ modelo do projeto: ${modelo.provider}/${modelo.name}`);

  assertar(
    modelo.provider !== 'ollama',
    `o modelo resolvido é LOCAL (${modelo.name}) — o ADR 0020 proíbe no passo semântico`,
  );

  // A política de terminal, decidida UMA vez — que é como o produto foi
  // desenhado depois da Fase F.
  //
  // `ActivateExecutionUseCase` já semeia `auto_approve` para
  // git_commit/git_push/pr_open, mas NÃO para terminal. E a regra de escopo
  // da RN-075 apenas REBAIXA `auto_approve` fora da pasta do projeto — ela
  // não promove. Sem uma linha de `allow`, todo `npm test` vira
  // `proposed_action` pendente e o agente para em `awaiting_approval`.
  //
  // Observado na 3ª execução: o dev agent escreveu três arquivos, chamou
  // `npm test --silent`, e ficou esperando alguém clicar. Aprovar comando a
  // comando é justamente a escada que a Fase F declarou inviável.
  //
  // Isto NÃO esconde a decisão: `proposed_action.created` carrega
  // `status: auto_approved` (ADR 0048), e o medidor separa política de
  // clique humano.
  //
  // O casamento é por PREFIXO DE TOKENS, e o allowlist governa o VERBO. Não há
  // padrão "libere tudo" — de propósito. O teto de escopo protege o CAMINHO,
  // não o verbo, então cada comando novo que o agente inventa (`ls -la` foi o
  // da 4ª execução) cai em `require_approval` se o verbo não estiver aqui.
  //
  // O CRITÉRIO da lista: verbos que LEEM ou CONSTROEM. Nada que busque na
  // rede (`curl`, `wget`) e nada que destrua (`rm`, `mv`, `chmod`, `sudo`) —
  // esses continuam pedindo decisão, que é o que a lista fechada existe para
  // garantir. O teto de escopo (RN-075) protege o CAMINHO; esta lista protege
  // o VERBO, e as duas coisas são independentes.
  //
  // `head` entrou depois da 6ª execução: o agente de QA rodou
  // `ls -la && find … | head -50`, e comando composto só é auto-aprovado
  // quando TODO segmento está liberado.
  const permissoes = app.get(PermissionsFileStore);
  for (const padrao of [
    // build e teste
    'Terminal(npm)',
    'Terminal(pnpm)',
    'Terminal(npx)',
    'Terminal(node)',
    'Terminal(yarn)',
    'Terminal(make)',
    // navegação e leitura
    'Terminal(ls)',
    'Terminal(cat)',
    'Terminal(pwd)',
    'Terminal(find)',
    'Terminal(grep)',
    'Terminal(head)',
    'Terminal(tail)',
    'Terminal(wc)',
    'Terminal(sort)',
    'Terminal(uniq)',
    'Terminal(cut)',
    'Terminal(tree)',
    'Terminal(stat)',
    'Terminal(file)',
    'Terminal(which)',
    'Terminal(diff)',
    'Terminal(env)',
    'Terminal(printenv)',
    // escrita DENTRO do projeto (o teto de escopo cuida do resto)
    'Terminal(mkdir)',
    'Terminal(touch)',
    'Terminal(echo)',
    'Terminal(git)',
  ]) {
    await permissoes.addPattern(project.id, 'allow', padrao);
  }
  log('✓ política: verbos de build/teste/inspeção liberados no projeto');

  const { sessionId } = await app
    .get(ActivateExecutionUseCase)
    .execute(project.id, owner.id, undefined, undefined, 'real');
  log(`sessão de execução: ${sessionId}`);
  log('  (o engine NÃO pode ser reiniciado daqui em diante — é critério)');

  // ---- o TETO de paralelismo, exercitado de verdade (RN-083) -------------
  //
  // A ativação sobe UM agente por módulo. Daqui em diante quem pede mais é o
  // lead, e é aqui que o teto da área cobra a sua decisão. Custa ZERO token:
  // é regra de domínio pura, não turno de LLM.
  {
    const pedir = () =>
      app
        .get(RequestParallelizationUseCase)
        .execute(project.id, sessionId, 'api', owner.id);

    const dentro = await pedir();
    assertar(
      dentro.estado === 'executado',
      `o 2º agente deveria caber no teto (2) e veio "${dentro.estado}"`,
    );
    log(`✓ 2º agente subiu SEM perguntar — dentro do teto (${dentro.maxParallel})`);

    const acima = await pedir();
    assertar(
      acima.estado === 'aguardando_autorizacao',
      `o 3º agente deveria pedir autorização e veio "${acima.estado}"`,
    );
    assertar(
      typeof acima.actionId === 'string' && acima.actionId.length > 0,
      'não veio `actionId`: sem ação, não há o que você decidir',
    );

    // O ponto: NADA subiu. Se tivesse subido, a autorização seria teatro.
    const [acao] = await db
      .select()
      .from(proposedActions)
      .where(eq(proposedActions.id, acima.actionId!));
    assertar(
      acao?.actionType === 'parallelize' && acao.status === 'pending',
      `a ação veio "${acao?.actionType}/${acao?.status}"`,
    );
    assertar(
      acao.resolvedPolicy === 'require_approval',
      `a ação resolveu "${acao.resolvedPolicy}" — o teto do decide.ts falhou (RN-086)`,
    );
    log(
      `✓ 3º agente PAROU: ação ${acima.actionId} pendente da sua decisão ` +
        `(${acima.ativosNaSessao} ativos, teto ${acima.maxParallel})`,
    );
  }

  // A PR é a primeira prova de que o dev agent real trabalhou: escreveu
  // código, commitou, deu push e abriu PR REMOTA.
  const pr = await esperar(
    'a PR remota do dev agent',
    async () => {
      const [linha] = await db
        .select()
        .from(proposedActions)
        .where(
          and(
            eq(proposedActions.projectId, project.id),
            eq(proposedActions.actionType, 'pr_open'),
          ),
        );
      return linha ?? null;
    },
    TIMEOUT_DEV_MS,
  );
  log(`✓ PR proposta: status=${pr.status}`);

  // O gate é julgado por AGENTE, não pelo script — é a diferença central em
  // relação à validação da Fase 12, que escrevia o veredito ela mesma.
  const comVeredito = await esperar(
    'os gates julgarem (QA e SecOps, por LLM)',
    async () => {
      const linhas = await db
        .select()
        .from(sessionEvents)
        .where(
          and(
            eq(sessionEvents.sessionId, sessionId),
            eq(sessionEvents.type, 'pr.gate_changed'),
          ),
        );
      const julgados = linhas.filter(
        (e) => (e.payload as Record<string, unknown>)?.veredito != null,
      );
      return julgados.length >= 2 ? julgados : null;
    },
    TIMEOUT_GATES_MS,
  );

  for (const e of comVeredito) {
    const p = e.payload as Record<string, unknown>;
    log(`✓ gate ${String(p.gate)}: ${String(p.veredito)} — evento \`${e.id}\``);
  }

  log(
    `\n[validacao-real] execução concluída SEM merge — ele é seu, por desenho (RN-014).\n` +
      `projeto: ${project.id}\nsessão de execução: ${sessionId}\n\n` +
      `Agora meça: pnpm --filter api medir:execucao -- --projeto ${project.id}`,
  );

  await app.close();
}

main().catch((error) => {
  console.error(`\nValidação falhou: ${String(error)}`);
  process.exit(1);
});
