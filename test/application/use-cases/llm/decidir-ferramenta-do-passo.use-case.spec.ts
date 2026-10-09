import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import type { ChatMessage, LLMProviderName, ToolDef } from '@brabo/shared';
import { createTestDb, truncateAll } from '../../../support/test-db';
import {
  projects,
  sessions,
  tokenUsage,
  users,
  workspaces,
} from '../../../../src/db/schema';
import { DrizzleUnitOfWork } from '../../../../src/infrastructure/persistence/drizzle/drizzle-unit-of-work';
import { DrizzleOutboxRepository } from '../../../../src/infrastructure/persistence/drizzle/outbox.repository';
import { DrizzleProjectRepository } from '../../../../src/infrastructure/persistence/drizzle/project.repository';
import { DrizzleBudgetRepository } from '../../../../src/infrastructure/persistence/drizzle/budget.repository';
import { DrizzleAgentAreaRepository } from '../../../../src/infrastructure/persistence/drizzle/agent-area.repository';
import { DrizzleTokenUsageRepository } from '../../../../src/infrastructure/persistence/drizzle/token-usage.repository';
import { DrizzleWorkspaceRepository } from '../../../../src/infrastructure/persistence/drizzle/workspace.repository';
import { GptTokenizerEstimator } from '../../../../src/infrastructure/tokenization/gpt-tokenizer-estimator';
import { RecordLlmUsageUseCase } from '../../../../src/application/use-cases/llm/record-llm-usage.use-case';
import { SeedAgentAreasUseCase } from '../../../../src/application/use-cases/agents/seed-agent-areas.use-case';
import { DecidirFerramentaDoPassoUseCase } from '../../../../src/application/use-cases/llm/decidir-ferramenta-do-passo.use-case';
import type {
  DecidirFerramentaInput,
  ResultadoDoRoteador,
  ToolRouter,
} from '../../../../src/application/ports/tool-router.port';
import { BraboMetrics } from '../../../../src/infrastructure/observability/brabo-metrics';
import {
  MODELO_DO_JEV,
  RESPONDER_SEM_FERRAMENTA,
} from '../../../../src/domain/llm/tool-router';

const { db, pool } = createTestDb();

const unitOfWork = new DrizzleUnitOfWork(db);
const projectRepo = new DrizzleProjectRepository(db);
const budgetRepo = new DrizzleBudgetRepository(db);
const areaRepo = new DrizzleAgentAreaRepository(db);
const workspaceRepo = new DrizzleWorkspaceRepository(db);
const recordLlmUsage = new RecordLlmUsageUseCase(
  new DrizzleTokenUsageRepository(db),
  budgetRepo,
  areaRepo,
  new DrizzleOutboxRepository(db),
  new BraboMetrics(),
);
const tokenEstimator = new GptTokenizerEstimator();

const tool = (name: string): ToolDef => ({
  name,
  description: `faz ${name}`,
  parameters: {},
});
const CATALOGO = ['read_file', 'write_file', 'terminal', 'report_done'].map(
  tool,
);

/** O Jev de mentira: devolve o que o teste mandar e guarda o que recebeu. */
class RoteadorFalso implements ToolRouter {
  chamadas: DecidirFerramentaInput[] = [];
  constructor(private readonly resultado: () => ResultadoDoRoteador) {}
  decidir(input: DecidirFerramentaInput): Promise<ResultadoDoRoteador> {
    this.chamadas.push(input);
    return Promise.resolve(this.resultado());
  }
}

const decidiu = (
  escolha: string,
  over: Partial<{
    custoUsd: number | null;
    tokensDeEntrada: number | null;
  }> = {},
): ResultadoDoRoteador => ({
  status: 'decidido',
  latenciaMs: 210,
  resposta: {
    status: 'ok',
    escolha,
    confianca: 0.9,
    probabilidades: { [escolha]: 0.9, report_done: 0.06 },
    custoUsd: 0.000051912,
    tokensDeEntrada: 1236,
    tokensDeSaida: 0,
    ...over,
  },
});

const cai = (
  motivo:
    | 'timeout'
    | 'erro_http'
    | 'erro_de_rede'
    | 'resposta_invalida'
    | 'escolha_fora_das_opcoes',
  custoUsd: number | null = null,
): ResultadoDoRoteador => ({
  status: 'queda',
  motivo,
  detalhe: 'x',
  latenciaMs: 2000,
  custoUsd,
  tokensDeEntrada: custoUsd === null ? null : 1236,
  tokensDeSaida: custoUsd === null ? null : 0,
});

/** Uma execução em curso: a mensagem inicial e um passo anterior com `read_file`. */
const COM_ANTERIOR: ChatMessage[] = [
  { role: 'system', content: 'Você é o dev-api.' },
  { role: 'user', content: 'implemente a tarefa' },
  {
    role: 'assistant',
    content: '',
    toolCalls: [{ id: 'c1', name: 'read_file', arguments: { path: 'a.ts' } }],
  },
  { role: 'tool', content: 'conteúdo', toolCallId: 'c1' },
];
const SEM_ANTERIOR: ChatMessage[] = COM_ANTERIOR.slice(0, 2);

function montar(roteador: ToolRouter, unit = unitOfWork) {
  return new DecidirFerramentaDoPassoUseCase(
    projectRepo,
    workspaceRepo,
    roteador,
    tokenEstimator,
    unit,
    recordLlmUsage,
  );
}

async function setup(toolRouterEnabled = true) {
  const [owner] = await db
    .insert(users)
    .values({ keycloakSub: 'sub-jev', email: 'jev@brabo.dev' })
    .returning();
  const [workspace] = await db
    .insert(workspaces)
    .values({
      name: 'acme',
      slug: 'acme',
      createdBy: owner.id,
      toolRouterEnabled,
    })
    .returning();
  const [project] = await db
    .insert(projects)
    .values({
      workspaceId: workspace.id,
      name: 'core',
      slug: 'core',
      createdBy: owner.id,
    })
    .returning();
  // As áreas nascem com o projeto no produto (RN-094); o insert cru daqui não as cria.
  await new SeedAgentAreasUseCase(areaRepo).execute(project.id, ['dev-api']);
  const [session] = await db
    .insert(sessions)
    .values({ projectId: project.id, createdBy: owner.id })
    .returning();
  return { project, session, workspace };
}

const base = (
  s: Awaited<ReturnType<typeof setup>>,
  over: Partial<Parameters<DecidirFerramentaDoPassoUseCase['decidir']>[0]> = {},
) => ({
  projectId: s.project.id,
  sessionId: s.session.id,
  agentId: 'dev-api',
  provider: 'openrouter' as LLMProviderName,
  apiKey: 'sk-or-v1-teste',
  messages: COM_ANTERIOR,
  tools: CATALOGO,
  ...over,
});

beforeEach(async () => {
  await truncateAll(db);
});
afterAll(async () => {
  await pool.end();
});

describe('DecidirFerramentaDoPassoUseCase — quando o Jev NÃO é chamado', () => {
  it('provider diferente de openrouter: nada é chamado, nem a leitura do workspace', async () => {
    const s = await setup();
    const roteador = new RoteadorFalso(() => decidiu('read_file'));
    for (const provider of [
      'ollama',
      'anthropic',
      'openai',
      'together',
    ] as LLMProviderName[]) {
      const r = await montar(roteador).decidir(base(s, { provider }));
      expect(r.toolRouting).toBeNull();
      expect(r.tools).toEqual(CATALOGO);
    }
    expect(roteador.chamadas).toHaveLength(0);
    expect(await db.select().from(tokenUsage)).toHaveLength(0);
  });

  it.each([
    ['uma ferramenta só', { tools: [tool('a')] }],
    ['nenhuma ferramenta', { tools: [] }],
    ['sem ferramentas', { tools: undefined }],
    ['sem agente (chat humano)', { agentId: undefined }],
    ['a Anamnese (pausada, fora do escopo)', { agentId: 'anamnese' }],
    ['o sumarizador da compactação', { agentId: 'context-manager' }],
    ['o engine pediu o catálogo inteiro', { catalogoCompleto: true }],
    ['sem credencial', { apiKey: undefined }],
  ])('%s: não chama e devolve o catálogo como veio', async (_nome, over) => {
    const s = await setup();
    const roteador = new RoteadorFalso(() => decidiu('read_file'));
    const entrada = base(s, over);
    const r = await montar(roteador).decidir(entrada);
    expect(roteador.chamadas).toHaveLength(0);
    expect(r.toolRouting).toBeNull();
    expect(r.tools).toEqual(entrada.tools);
  });

  it('workspace com o roteamento desligado: nada é chamado, nenhum gasto', async () => {
    const s = await setup(false);
    const roteador = new RoteadorFalso(() => decidiu('read_file'));
    const r = await montar(roteador).decidir(base(s));
    expect(roteador.chamadas).toHaveLength(0);
    expect(r.toolRouting).toBeNull();
    expect(r.tools).toEqual(CATALOGO);
  });

  it('o desligador é por workspace e vale na hora (o padrão da coluna é ligado)', async () => {
    const s = await setup();
    const roteador = new RoteadorFalso(() => decidiu('write_file'));
    const uc = montar(roteador);
    expect((await uc.decidir(base(s))).toolRouting).not.toBeNull();
    await workspaceRepo.setToolRouterEnabled(s.workspace.id, false);
    expect((await uc.decidir(base(s))).toolRouting).toBeNull();
    expect(roteador.chamadas).toHaveLength(1);
  });

  it('catálogo com ferramenta chamada `responder_sem_ferramenta`: colisão, sem chamada', async () => {
    const s = await setup();
    const roteador = new RoteadorFalso(() => decidiu('read_file'));
    const tools = [...CATALOGO, tool(RESPONDER_SEM_FERRAMENTA)];
    const r = await montar(roteador).decidir(base(s, { tools }));
    expect(roteador.chamadas).toHaveLength(0);
    expect(r.tools).toEqual(tools);
    expect(r.toolRouting).toMatchObject({
      aplicado: false,
      motivoDaQueda: 'colisao_de_nome',
      origemDaQueda: 'codigo',
    });
  });

  it.each([
    ['pelo tamanho em caracteres, sem tokenizar', 'palavra '.repeat(10_000)],
    ['pelos tokens', '1234567890'.repeat(3_000)],
  ])(
    'estado que não cabe no teto (%s): queda estado_grande, sem chamada',
    async (_como, descricao) => {
      const s = await setup();
      const roteador = new RoteadorFalso(() => decidiu('read_file'));
      const enorme = tool('grande');
      enorme.description = descricao;
      const r = await montar(roteador).decidir(
        base(s, { tools: [...CATALOGO, enorme] }),
      );
      expect(roteador.chamadas).toHaveLength(0);
      expect(r.toolRouting?.motivoDaQueda).toBe('estado_grande');
      expect(r.toolRouting?.origemDaQueda).toBe('codigo');
      expect(r.tools).toHaveLength(CATALOGO.length + 1);
    },
  );
});

describe('DecidirFerramentaDoPassoUseCase — a política P3', () => {
  it('menu = {escolha do Jev, ferramenta anterior da mesma execução}', async () => {
    const s = await setup();
    const roteador = new RoteadorFalso(() => decidiu('write_file'));
    const r = await montar(roteador).decidir(base(s));

    expect(r.tools?.map((t) => t.name)).toEqual(['read_file', 'write_file']);
    expect(r.toolRouting).toMatchObject({
      modelo: 'typesafe/jev-1.13',
      ofertadas: 4,
      menuAntes: ['read_file', 'write_file', 'terminal', 'report_done'],
      menuDepois: ['read_file', 'write_file'],
      escolha: 'write_file',
      confianca: 0.9,
      anterior: 'read_file',
      aplicado: true,
      motivoDaQueda: null,
      latenciaMs: 210,
      custoMicros: 52,
    });
    expect(r.toolRouting?.segunda).toEqual({
      opcao: 'report_done',
      probabilidade: 0.06,
    });
  });

  it('o pedido ao Jev leva o state do produto: agente, pedido, contexto e os passos da execução', async () => {
    const s = await setup();
    const roteador = new RoteadorFalso(() => decidiu('write_file'));
    await montar(roteador).decidir(base(s));
    const enviado = roteador.chamadas[0];
    expect(enviado.apiKey).toBe('sk-or-v1-teste');
    expect(enviado.opcoes).toEqual(CATALOGO.map((t) => t.name));
    expect(enviado.pedido.state).toMatchObject({
      agente: 'dev-api',
      pedido: 'implemente a tarefa',
      contexto: 'Você é o dev-api.',
      passos_recentes: [{ ferramenta: 'read_file', resultado: 'conteúdo' }],
    });
    expect(enviado.pedido.model).toBe('typesafe/jev-1.13');
  });

  it('o Jev diz `responder_sem_ferramenta`: o catálogo INTEIRO segue (o Jev só restringe)', async () => {
    const s = await setup();
    const r = await montar(
      new RoteadorFalso(() => decidiu(RESPONDER_SEM_FERRAMENTA)),
    ).decidir(base(s));
    expect(r.tools).toEqual(CATALOGO);
    expect(r.toolRouting).toMatchObject({
      escolha: RESPONDER_SEM_FERRAMENTA,
      aplicado: false,
      motivoDaQueda: null,
    });
  });

  it('sem ferramenta anterior na execução: o catálogo inteiro, mesmo com escolha firme', async () => {
    const s = await setup();
    const r = await montar(
      new RoteadorFalso(() => decidiu('write_file')),
    ).decidir(base(s, { messages: SEM_ANTERIOR }));
    expect(r.tools).toEqual(CATALOGO);
    expect(r.toolRouting).toMatchObject({
      escolha: 'write_file',
      anterior: null,
      aplicado: false,
    });
  });

  it('escolha = anterior: menu de UMA ferramenta', async () => {
    const s = await setup();
    const r = await montar(
      new RoteadorFalso(() => decidiu('read_file')),
    ).decidir(base(s));
    expect(r.tools?.map((t) => t.name)).toEqual(['read_file']);
  });

  it('a política não muda: o Jev só devolve um SUBCONJUNTO de ToolDef do catálogo, sem tocar em aprovação', async () => {
    const s = await setup();
    const r = await montar(
      new RoteadorFalso(() => decidiu('terminal')),
    ).decidir(base(s));
    // O que sai é o próprio objeto do catálogo — nenhum campo de autonomia,
    // aprovação ou permissão é acrescentado ou removido. `terminal` que exige
    // aprovação continua exigindo: quem decide isso é `decide()`, que o
    // roteador nem importa (ver o teste estrutural abaixo).
    for (const t of r.tools ?? []) {
      expect(CATALOGO).toContain(t);
    }
    expect(Object.keys(r.toolRouting ?? {})).not.toContain('aprovacao');
  });
});

describe('DecidirFerramentaDoPassoUseCase — o turno nunca falha por causa do Jev', () => {
  it.each([
    ['timeout', 'infra'],
    ['erro_http', 'infra'],
    ['erro_de_rede', 'infra'],
    ['resposta_invalida', 'modelo'],
    ['escolha_fora_das_opcoes', 'modelo'],
  ] as const)(
    'queda por %s: catálogo inteiro, origem %s, sem gasto quando nada foi cobrado',
    async (motivo, origem) => {
      const s = await setup();
      const r = await montar(new RoteadorFalso(() => cai(motivo))).decidir(
        base(s),
      );
      expect(r.tools).toEqual(CATALOGO);
      expect(r.toolRouting).toMatchObject({
        aplicado: false,
        motivoDaQueda: motivo,
        origemDaQueda: origem,
        menuDepois: CATALOGO.map((t) => t.name),
        custoMicros: 0,
      });
      expect(await db.select().from(tokenUsage)).toHaveLength(0);
    },
  );

  it('escolha fora das opções mas COM custo: o Jev cobrou, então o gasto é registrado', async () => {
    const s = await setup();
    const r = await montar(
      new RoteadorFalso(() => cai('escolha_fora_das_opcoes', 0.000051912)),
    ).decidir(base(s));
    expect(r.tools).toEqual(CATALOGO);
    expect(r.toolRouting?.custoMicros).toBe(52);
    expect(await db.select().from(tokenUsage)).toHaveLength(1);
  });

  it('o roteador lançar (não deveria) NÃO derruba o turno', async () => {
    const s = await setup();
    const explode: ToolRouter = {
      decidir: () => Promise.reject(new Error('quebrou')),
    };
    const r = await montar(explode).decidir(base(s));
    expect(r.tools).toEqual(CATALOGO);
    expect(r.toolRouting).toMatchObject({
      aplicado: false,
      origemDaQueda: 'codigo',
    });
  });

  it('a leitura do workspace falhar NÃO derruba o turno: segue sem Jev', async () => {
    const s = await setup();
    const roteador = new RoteadorFalso(() => decidiu('read_file'));
    const uc = new DecidirFerramentaDoPassoUseCase(
      projectRepo,
      {
        ...workspaceRepo,
        findById: () => Promise.reject(new Error('banco')),
      } as never,
      roteador,
      tokenEstimator,
      unitOfWork,
      recordLlmUsage,
    );
    const r = await uc.decidir(base(s));
    expect(r.tools).toEqual(CATALOGO);
    expect(r.toolRouting).toBeNull();
    expect(roteador.chamadas).toHaveLength(0);
  });

  it('gravar o gasto falhar NÃO derruba o turno, e o evento diz que o gasto não foi registrado', async () => {
    const s = await setup();
    const unitQueFalha = {
      runInTransaction: () => Promise.reject(new Error('banco caiu')),
    } as never;
    const r = await montar(
      new RoteadorFalso(() => decidiu('write_file')),
      unitQueFalha,
    ).decidir(base(s));
    expect(r.tools?.map((t) => t.name)).toEqual(['read_file', 'write_file']);
    expect(r.toolRouting).toMatchObject({
      aplicado: true,
      gastoNaoRegistrado: true,
      custoMicros: 52,
    });
  });
});

describe('DecidirFerramentaDoPassoUseCase — o gasto do Jev (metering)', () => {
  it('uma linha de token_usage com o custo REAL, no ator do próprio agente, separada do chat pelo modelName', async () => {
    const s = await setup();
    await montar(new RoteadorFalso(() => decidiu('write_file'))).decidir(
      base(s),
    );

    const linhas = await db
      .select()
      .from(tokenUsage)
      .where(eq(tokenUsage.sessionId, s.session.id));
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({
      actorKind: 'agent',
      actorId: 'dev-api',
      provider: 'openrouter',
      modelId: null,
      modelName: MODELO_DO_JEV,
      inputTokens: 1236,
      outputTokens: 0,
      estimated: false,
      costMicros: 52,
      priceImplicit: true,
      latencyMs: 210,
      bindingOrigin: null,
    });
    // RN-044: tokens × preço = custo, com o preço IMPLÍCITO.
    const l = linhas[0];
    expect(
      Math.round((l.inputTokens * l.inputPricePerMillionMicros) / 1_000_000),
    ).toBe(l.costMicros);
    // O gasto do Jev entra no orçamento de ÁREA (ADR 0110): o ator é o próprio agente.
    const areas = await areaRepo.listByProject(s.project.id);
    expect(areas.find((a) => a.key === 'dev')?.spentMicros).toBe(52);
  });

  it('entra no orçamento como qualquer gasto (projeto e sessão)', async () => {
    const s = await setup();
    const proj = await budgetRepo.upsertForProject(s.project.id, {
      limitMicros: 1_000_000,
      policy: 'allow',
    });
    const sess = await budgetRepo.upsertForSession(s.session.id, {
      limitMicros: 1_000_000,
      policy: 'allow',
    });
    await montar(new RoteadorFalso(() => decidiu('write_file'))).decidir(
      base(s),
    );
    expect((await budgetRepo.findForProject(s.project.id))!.spentMicros).toBe(
      52,
    );
    expect((await budgetRepo.findForSession(s.session.id))!.spentMicros).toBe(
      52,
    );
    expect(proj.id).toBeTruthy();
    expect(sess.id).toBeTruthy();
  });

  it('resposta sem tokens: estima e MARCA estimated=true (não finge custo medido)', async () => {
    const s = await setup();
    await montar(
      new RoteadorFalso(() => decidiu('write_file', { tokensDeEntrada: null })),
    ).decidir(base(s));
    const [linha] = await db.select().from(tokenUsage);
    expect(linha.estimated).toBe(true);
    expect(linha.inputTokens).toBeGreaterThan(0);
  });

  it('resposta sem usage.cost: não há custo real a gravar, nenhuma linha', async () => {
    const s = await setup();
    await montar(
      new RoteadorFalso(() => decidiu('write_file', { custoUsd: null })),
    ).decidir(base(s));
    expect(await db.select().from(tokenUsage)).toHaveLength(0);
  });
});

/** Uma execução do agente com UMA ferramenta anterior, para o recorte P3 morder. */
const execucaoCom = (agente: string, anterior: string): ChatMessage[] => [
  { role: 'system', content: `Você é o ${agente}.` },
  { role: 'user', content: 'siga' },
  {
    role: 'assistant',
    content: '',
    toolCalls: [{ id: 'c1', name: anterior, arguments: {} }],
  },
  { role: 'tool', content: 'ok', toolCallId: 'c1' },
];

describe('DecidirFerramentaDoPassoUseCase — o recorte não vira incapacidade (AT-445)', () => {
  const PO = [
    'listar_backlog',
    'listar_regras',
    'create_story',
    'create_task',
    'emit_artifact',
    'offer_handoff',
  ].map(tool);
  const ARQUITETO = [
    'create_module_map',
    'assign_story_modules',
    'choose_project_image',
    'create_c4_diagram',
    'route_modules_to_infra',
    'declare_module_contracts',
    'propose_adr',
    'emit_insight',
    'emit_artifact',
  ].map(tool);

  it('PO com o menu do Jev ["listar_backlog","create_story"]: `create_task` continua no menu e o aviso chega', async () => {
    const s = await setup();
    const msgs = execucaoCom('po', 'listar_backlog');
    const r = await montar(
      new RoteadorFalso(() => decidiu('create_story')),
    ).decidir(base(s, { agentId: 'po', tools: PO, messages: msgs }));

    expect(r.tools?.map((t) => t.name)).toEqual([
      'listar_backlog',
      'create_story',
      'create_task',
    ]);
    expect(r.toolRouting?.aplicado).toBe(true);
    const aviso = r.messages.at(-1)!;
    expect(aviso.role).toBe('system');
    expect(aviso.content).toContain('recorte');
    expect(aviso.content).toContain('seguem disponíveis');
    // Efêmero: o array do pedido (o histórico do agente) não é tocado.
    expect(r.messages).toHaveLength(5);
    expect(msgs).toHaveLength(4);
  });

  it('Arquiteto com 2 de 9 pelo Jev: as cinco de artefato (mapa, roteamento, contratos, ADR, C4) nunca saem', async () => {
    const s = await setup();
    const r = await montar(
      new RoteadorFalso(() => decidiu('assign_story_modules')),
    ).decidir(
      base(s, {
        agentId: 'arquiteto',
        tools: ARQUITETO,
        messages: execucaoCom('arquiteto', 'choose_project_image'),
      }),
    );
    expect(r.tools?.map((t) => t.name)).toEqual([
      'create_module_map',
      'assign_story_modules',
      'choose_project_image',
      'create_c4_diagram',
      'route_modules_to_infra',
      'declare_module_contracts',
      'propose_adr',
    ]);
    expect(r.messages.at(-1)!.content).toContain('as outras 2 seguem');
  });

  it('o Jev diz responder (sem recorte): nenhum aviso, mensagens intactas', async () => {
    const s = await setup();
    const msgs = execucaoCom('po', 'listar_backlog');
    const r = await montar(
      new RoteadorFalso(() => decidiu(RESPONDER_SEM_FERRAMENTA)),
    ).decidir(base(s, { agentId: 'po', tools: PO, messages: msgs }));
    expect(r.toolRouting?.aplicado).toBe(false);
    expect(r.messages).toBe(msgs);
  });

  it('queda do Jev: catálogo inteiro e nenhum aviso', async () => {
    const s = await setup();
    const msgs = execucaoCom('po', 'listar_backlog');
    const r = await montar(new RoteadorFalso(() => cai('timeout'))).decidir(
      base(s, { agentId: 'po', tools: PO, messages: msgs }),
    );
    expect(r.tools).toHaveLength(PO.length);
    expect(r.messages).toBe(msgs);
  });
});
