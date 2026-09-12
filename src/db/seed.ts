/**
 * Seed de demonstração: 1 workspace, 2 usuários com papéis distintos,
 * 1 projeto e 1 sessão com 5 eventos.
 *
 * Roda os use cases reais via um application context do Nest (sem
 * HTTP, sem guards — guards só interceptam a pipeline HTTP) para
 * exercitar o mesmo caminho de código usado pela API (outbox incluso).
 *
 * IDEMPOTENTE de ponta a ponta. Rodar de novo sobre um banco já semeado é o
 * caso NORMAL, não a exceção: o `bootstrap.sh` do k8s chama este arquivo com
 * `BRABO_FORCE_SEED=1` contra um cluster que pode já ter sido semeado, e quem
 * vê `scripts/dev/reset-total.sh` falhar no meio tenta se recuperar rodando só
 * o seed. Usuários, credenciais, modelos, curadoria, bindings e instruções já
 * eram idempotentes (todos passam por `upsert`); o workspace, o projeto e a
 * sessão NÃO eram, e a segunda tentativa morria em
 * `duplicate key value violates unique constraint "workspaces_slug_unique"` —
 * depois de já ter escrito usuários, credenciais e modelos. Ou seja: quem
 * tentava se recuperar sozinho ficava pior do que estava, e com uma mensagem
 * de Postgres que não aponta para nada.
 *
 * A regra é reaproveitar, nunca duplicar nem re-escrever: achado o registro de
 * demonstração, o seed segue com ELE. Para a sessão isso vale também para os
 * eventos — reencontrada a sessão, os 5 eventos NÃO são acrescentados de novo,
 * senão cada reseed empilharia mais cinco numa timeline que existe para
 * demonstrar cinco. Quem quer estado limpo apaga o banco
 * (`scripts/dev/reset-total.sh`, item Docker › Reset total do bootstrap).
 *
 * Uso: pnpm --filter api seed
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { provisionarUsuario } from '../scripts/provisionar-usuario';
import { CreateWorkspaceUseCase } from '../application/use-cases/iam/create-workspace.use-case';
import { AddWorkspaceMemberUseCase } from '../application/use-cases/iam/add-workspace-member.use-case';
import { CreateProjectUseCase } from '../application/use-cases/iam/create-project.use-case';
import { CreateSessionUseCase } from '../application/use-cases/sessions/create-session.use-case';
import { TransitionSessionUseCase } from '../application/use-cases/sessions/transition-session.use-case';
import { AppendSessionEventUseCase } from '../application/use-cases/sessions/append-session-event.use-case';
import {
  ModelRepository,
  type ModelInput,
} from '../application/ports/model-repository.port';
import { WorkspaceRepository } from '../application/ports/workspace-repository.port';
import { ProjectRepository } from '../application/ports/project-repository.port';
import { SessionRepository } from '../application/ports/session-repository.port';
import type { Model } from '../domain/llm/model.entity';
import { UpdateModelPricingUseCase } from '../application/use-cases/llm/update-model-pricing.use-case';
import { SetModelsActiveUseCase } from '../application/use-cases/llm/set-models-active.use-case';
import { SetModelBindingUseCase } from '../application/use-cases/llm/set-model-binding.use-case';
import { chaveDeAgente } from '../domain/llm/binding-scope-id';
import { UpsertAgentInstructionUseCase } from '../application/use-cases/agents/upsert-agent-instruction.use-case';
import {
  CRIATIVO_AGENT,
  CRIATIVO_INSTRUCTIONS,
} from './seeds/criativo-instructions';
import type { LLMProviderName } from '@brabo/shared';
import { UpsertUserCredentialUseCase } from '../application/use-cases/llm/upsert-user-credential.use-case';

/**
 * Credenciais de provider pré-salvas (opcional): reaproveita as MESMAS
 * variáveis `<PROVIDER>_TEST_KEY` que os smokes de LLM já usam
 * (apps/api/test/infrastructure/llm/*.smoke.spec.ts) — uma convenção de
 * nome só, dois consumidores. Quem já tem uma chave em `.env` não precisa
 * recadastrá-la na UI toda vez que reseta o banco local (ver
 * scripts/dev/reset-total.sh). `ollama` fica de fora: é local, não pede
 * credencial.
 */
const CREDENCIAL_ENV_VARS: Partial<Record<LLMProviderName, string>> = {
  anthropic: 'ANTHROPIC_TEST_KEY',
  openai: 'OPENAI_TEST_KEY',
  openrouter: 'OPENROUTER_TEST_KEY',
  'nvidia-nim': 'NVIDIA_NIM_TEST_KEY',
  together: 'TOGETHER_TEST_KEY',
  deepinfra: 'DEEPINFRA_TEST_KEY',
  bitdeer: 'BITDEER_TEST_KEY',
  vultr: 'VULTR_TEST_KEY',
};

/**
 * Os três registros de demonstração que este arquivo cria, num lugar só — é
 * por estes valores que a rodada seguinte os RECONHECE. Constante e não
 * literal repetido: procurar por um slug e criar com outro produziria dois
 * workspaces em vez de um, e o defeito só apareceria na segunda rodada.
 */
const WORKSPACE_SEED = { name: 'Acme Corp', slug: 'acme-corp' };
const PROJETO_SEED = { name: 'Core API', slug: 'core-api' };
/**
 * `criativa` e com nome: a sessão do seed é a que demonstra o fluxo inteiro
 * (Criativo → PO → Arquiteto), e o nome exercita o rótulo composto da RN-098
 * já na primeira tela que alguém abre. O nome é também a identidade que a
 * releitura procura — sessão não tem slug.
 */
const SESSAO_SEED = { kind: 'criativa' as const, name: 'Ideação inicial' };

// Preços aproximados de mercado (micro-USD por 1M tokens) — editáveis
// depois (ver README: "models" não tem endpoint HTTP de edição na
// Fase 1, corrija aqui ou via SQL direto).
//
// `supportsToolCalling` é explícito em cada linha (Fase 9a — ADR 0041): o
// default da coluna é `false`, e um binding de agente para modelo sem tool
// calling é recusado no domínio. Os sete abaixo têm suporte nativo
// verificado — a migração 0026 faz o mesmo backfill para bancos já criados.
const MODEL_SEEDS: ModelInput[] = [
  {
    provider: 'ollama',
    name: 'llama3.2:1b',
    displayName: 'Llama 3.2 1B (local)',
    inputPricePerMillionMicros: 0,
    outputPricePerMillionMicros: 0,
    supportsToolCalling: true,
  },
  {
    // Modelo local de código — é o que roda os dev agents num ambiente sem
    // chave paga (o llama3.2:1b não sustenta tool calling encadeado).
    provider: 'ollama',
    name: 'qwen2.5-coder:7b',
    displayName: 'Qwen2.5 Coder 7B (local)',
    inputPricePerMillionMicros: 0,
    outputPricePerMillionMicros: 0,
    supportsToolCalling: true,
  },
  {
    provider: 'anthropic',
    name: 'claude-opus-4-8',
    displayName: 'Claude Opus 4.8',
    inputPricePerMillionMicros: 5_000_000,
    outputPricePerMillionMicros: 25_000_000,
    supportsToolCalling: true,
  },
  {
    provider: 'anthropic',
    name: 'claude-sonnet-5',
    displayName: 'Claude Sonnet 5',
    inputPricePerMillionMicros: 3_000_000,
    outputPricePerMillionMicros: 15_000_000,
    supportsToolCalling: true,
  },
  {
    provider: 'anthropic',
    name: 'claude-haiku-4-5-20251001',
    displayName: 'Claude Haiku 4.5',
    inputPricePerMillionMicros: 1_000_000,
    outputPricePerMillionMicros: 5_000_000,
    supportsToolCalling: true,
  },
  {
    provider: 'openai',
    name: 'gpt-4o',
    displayName: 'GPT-4o',
    inputPricePerMillionMicros: 2_500_000,
    outputPricePerMillionMicros: 10_000_000,
    supportsToolCalling: true,
  },
  {
    provider: 'openai',
    name: 'gpt-4o-mini',
    displayName: 'GPT-4o mini',
    inputPricePerMillionMicros: 150_000,
    outputPricePerMillionMicros: 600_000,
    supportsToolCalling: true,
  },
  // NVIDIA NIM (Fase 11b) — `listModels: false` (o catálogo hospedado não
  // informa preço em nenhuma doc verificada), então o provider só existe pra
  // curadoria através deste seed.
  //
  // A busca por fonte oficial foi REFEITA e chegou a uma resposta melhor que
  // "não achei": a NVIDIA **não cobra por token**. A doc oficial
  // (https://docs.api.nvidia.com/nim/docs/product) diz que o endpoint
  // hospedado é acesso gratuito de PROTOTIPAGEM pra membro do Developer
  // Program, e que produção exige licença NVIDIA AI Enterprise — "These
  // licenses start at $4500 per GPU per year or ~ $1 per GPU per hour in the
  // cloud". Unidade por GPU/hora, não por token.
  //
  // Ou seja: não existe preço oficial por token pra converter, e nunca vai
  // existir enquanto o modelo comercial for esse. Os valores abaixo seguem
  // sendo ESTIMATIVA por comparação com modelos equivalentes noutros
  // providers — o suficiente pra o teto de orçamento ter o que descontar, e
  // marcado com `manualPricing: true` pra o sync nunca sobrescrever sem
  // decisão explícita.
  {
    provider: 'nvidia-nim',
    name: 'meta/llama-3.1-70b-instruct',
    displayName: 'Llama 3.1 70B Instruct (NVIDIA NIM)',
    inputPricePerMillionMicros: 600_000,
    outputPricePerMillionMicros: 600_000,
    supportsToolCalling: true,
    manualPricing: true,
  },
  {
    provider: 'nvidia-nim',
    name: 'nvidia/llama-3.1-nemotron-70b-instruct',
    displayName: 'Llama 3.1 Nemotron 70B Instruct (NVIDIA NIM)',
    inputPricePerMillionMicros: 600_000,
    outputPricePerMillionMicros: 600_000,
    supportsToolCalling: false,
    manualPricing: true,
  },
  {
    provider: 'nvidia-nim',
    name: 'meta/llama-3.2-3b-instruct',
    displayName: 'Llama 3.2 3B Instruct (NVIDIA NIM)',
    inputPricePerMillionMicros: 50_000,
    outputPricePerMillionMicros: 50_000,
    supportsToolCalling: false,
    manualPricing: true,
  },
  // Together AI (Fase 11b) — `listModels: true` (o sync cobre o catálogo
  // assim que houver credencial), estas 2 linhas são só bootstrap pra não
  // ficar vazio antes do primeiro sync. Preço batido contra
  // together.ai/models nesta sessão; `manualPricing: false` porque o sync
  // PODE atualizar (ao contrário da NIM, aqui o catálogo tem preço real).
  {
    provider: 'together',
    name: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    displayName: 'Llama 3.3 70B Instruct Turbo (Together)',
    inputPricePerMillionMicros: 880_000,
    outputPricePerMillionMicros: 880_000,
    supportsToolCalling: true,
  },
  {
    provider: 'together',
    name: 'openai/gpt-oss-20b',
    displayName: 'GPT-OSS 20B (Together)',
    inputPricePerMillionMicros: 50_000,
    outputPricePerMillionMicros: 200_000,
    supportsToolCalling: true,
  },
  // DeepInfra (Fase 11b) — `listModels: true` (o catálogo é PÚBLICO, sem
  // autenticação, confirmado ao vivo nesta sessão), mas o seed é
  // OBRIGATÓRIO mesmo assim: sem tester de conexão declarado (nenhum
  // endpoint autenticado de validação foi encontrado — o próprio catálogo
  // não exige chave), o primeiro sync só roda depois que ALGUÉM cadastrar
  // uma credencial de qualquer jeito. Preço e contexto confirmados AO VIVO
  // contra `GET /v1/openai/models` nesta sessão — `manualPricing: false`
  // porque o sync PODE atualizar. `supportsToolCalling: false`: a doc não
  // confirma a capability por modelo (diferente do id em si, que é real).
  {
    provider: 'deepinfra',
    name: 'deepseek-ai/DeepSeek-V3',
    displayName: 'DeepSeek V3 (DeepInfra)',
    inputPricePerMillionMicros: 320_000,
    outputPricePerMillionMicros: 890_000,
    contextWindow: 163_840,
    supportsToolCalling: false,
  },
  {
    provider: 'deepinfra',
    name: 'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo',
    displayName: 'Llama 3.1 70B Instruct Turbo (DeepInfra)',
    inputPricePerMillionMicros: 400_000,
    outputPricePerMillionMicros: 400_000,
    contextWindow: 131_072,
    supportsToolCalling: false,
  },
  {
    provider: 'deepinfra',
    name: 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo',
    displayName: 'Llama 3.1 8B Instruct Turbo (DeepInfra)',
    inputPricePerMillionMicros: 20_000,
    outputPricePerMillionMicros: 40_000,
    contextWindow: 131_072,
    supportsToolCalling: false,
  },
  // Bitdeer (Fase 11b) — `listModels: false` (nenhum shape de preço
  // verificado publicamente), MAS os três ids abaixo são REAIS, confirmados
  // em exemplos de configuração do próprio blog da Bitdeer nesta sessão
  // (não são nomes de vitrine — são o valor literal que vai no campo
  // `model`). Preço da Bitdeer em si segue sem fonte: a página
  // `bitdeer.ai/en/pricing/ai-models` monta a tabela no cliente (o HTML
  // servido não traz nome de modelo nenhum — verificado de novo nesta
  // sessão) e não há doc de preço fora dela. Os valores são ESTIMATIVA por
  // comparação com o mesmo modelo/família noutros providers, com
  // `manualPricing: true`. Corrigir assim que houver fonte oficial legível
  // da própria Bitdeer.
  {
    provider: 'bitdeer',
    name: 'moonshotai/Kimi-K2.5',
    displayName: 'Kimi K2.5 (Bitdeer)',
    inputPricePerMillionMicros: 900_000,
    outputPricePerMillionMicros: 3_500_000,
    supportsToolCalling: false,
    manualPricing: true,
  },
  {
    provider: 'bitdeer',
    name: 'zai-org/GLM-5',
    displayName: 'GLM-5 (Bitdeer)',
    inputPricePerMillionMicros: 1_200_000,
    outputPricePerMillionMicros: 4_000_000,
    supportsToolCalling: false,
    manualPricing: true,
  },
  {
    provider: 'bitdeer',
    name: 'nvidia/NVIDIA-Nemotron-3-Super-120B-A12B',
    displayName: 'NVIDIA Nemotron 3 Super 120B (Bitdeer)',
    inputPricePerMillionMicros: 600_000,
    outputPricePerMillionMicros: 1_800_000,
    supportsToolCalling: false,
    manualPricing: true,
  },
  // Vultr (Fase 11b) — `listModels: false` (a rota que a base chama,
  // `GET /models`, não tem preço na doc oficial; a rota com preço
  // documentado devolveu 404 ao vivo nesta sessão — decisão MUDOU do plano
  // original, que apontava `true`). `kimi-k2-instruct` é tool-calling
  // CONFIRMADO com exemplo real na doc oficial nesta sessão
  // (finish_reason: "tool_calls"); os outros dois vêm de exemplo de doc
  // sem confirmação de tool calling.
  //
  // Preço OFICIAL, não mais estimativa. A doc da Vultr publica a tarifa em
  // https://docs.vultr.com/support/products/serverless/how-do-i-monitor-the-usage-and-cost-of-my-vultr-serverless-inference-subscription:
  // "Requests are billed at $0.55 per 1,000,000 input tokens and $2.75 per
  // 1,000,000 output tokens." É tarifa ÚNICA do serviço — a doc não
  // diferencia por modelo, e por isso as três linhas repetem o mesmo par.
  //
  // A estimativa anterior errava na direção perigosa: 400_000 de SAÍDA para
  // dois dos três modelos, contra 2_750_000 reais. O metering subestimava o
  // custo de saída em quase 7×, e é a saída que domina a conta de um agente
  // que escreve código. `manualPricing` continua `true` porque o número
  // vem de doc lida por gente, não de sync (é o que a flag significa —
  // `schema.ts:507`); o que mudou é que agora ele é o número do provider.
  {
    provider: 'vultr',
    name: 'kimi-k2-instruct',
    displayName: 'Kimi K2 Instruct (Vultr)',
    inputPricePerMillionMicros: 550_000,
    outputPricePerMillionMicros: 2_750_000,
    supportsToolCalling: true,
    manualPricing: true,
  },
  {
    provider: 'vultr',
    name: 'llama-3.3-70b-instruct-fp8',
    displayName: 'Llama 3.3 70B Instruct FP8 (Vultr)',
    inputPricePerMillionMicros: 550_000,
    outputPricePerMillionMicros: 2_750_000,
    supportsToolCalling: false,
    manualPricing: true,
  },
  {
    provider: 'vultr',
    name: 'deepseek-r1-distill-llama-70b',
    displayName: 'DeepSeek R1 Distill Llama 70B (Vultr)',
    inputPricePerMillionMicros: 550_000,
    outputPricePerMillionMicros: 2_750_000,
    supportsToolCalling: false,
    manualPricing: true,
  },
];

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  const createWorkspace = app.get(CreateWorkspaceUseCase);
  const addWorkspaceMember = app.get(AddWorkspaceMemberUseCase);
  const createProject = app.get(CreateProjectUseCase);
  const createSession = app.get(CreateSessionUseCase);
  const transitionSession = app.get(TransitionSessionUseCase);
  const appendSessionEvent = app.get(AppendSessionEventUseCase);
  const models = app.get(ModelRepository);
  // Os três repositórios de LEITURA da idempotência — ver o docblock do topo.
  // São os mesmos que a api usa; nenhum método novo foi preciso.
  const workspaces = app.get(WorkspaceRepository);
  const projects = app.get(ProjectRepository);
  const sessions = app.get(SessionRepository);
  const updateModelPricing = app.get(UpdateModelPricingUseCase);
  const setModelsActive = app.get(SetModelsActiveUseCase);
  const setModelBinding = app.get(SetModelBindingUseCase);
  const upsertAgentInstruction = app.get(UpsertAgentInstructionUseCase);
  const upsertUserCredential = app.get(UpsertUserCredentialUseCase);

  // Senha conhecida e e-mail já verificado: é seed de desenvolvimento, e sem
  // Keycloak não existe mais um login pronto para entrar na aplicação depois
  // de semear. `provisionarUsuario` recusa rodar em produção.
  const senhaSeed = process.env.BRABO_SEED_PASSWORD ?? 'brabo12345678';

  const { user: owner } = await provisionarUsuario(app, {
    email: 'owner@brabo.dev',
    nome: 'Dona da Casa',
    senha: senhaSeed,
  });
  const { user: developer } = await provisionarUsuario(app, {
    email: 'dev@brabo.dev',
    nome: 'Dev Sênior',
    senha: senhaSeed,
  });
  console.log(
    `✓ usuários: ${owner.email} (owner), ${developer.email} (developer) — senha: ${senhaSeed}`,
  );

  // A chave que um agente gasta é a do OWNER do workspace (RN-058) — é dele
  // que a credencial fica. Provider sem variável definida não entra, sem erro.
  for (const [provider, envVar] of Object.entries(CREDENCIAL_ENV_VARS) as [
    LLMProviderName,
    string,
  ][]) {
    const apiKey = process.env[envVar];
    if (!apiKey) continue;
    await upsertUserCredential.execute(owner.id, provider, apiKey);
    console.log(
      `✓ credencial: ${provider} ativada para ${owner.email} (via ${envVar})`,
    );
  }

  // `listForUser` e não um `findBySlug` novo: o owner é membro do workspace
  // que ele cria (CreateWorkspaceUseCase o adiciona como `owner` na mesma
  // transação), então ele é o caminho que já existe até este registro.
  const workspaceExistente = (await workspaces.listForUser(owner.id))
    .map((linha) => linha.workspace)
    .find((w) => w.slug === WORKSPACE_SEED.slug);
  const workspace =
    workspaceExistente ??
    (await createWorkspace.execute(owner.id, WORKSPACE_SEED));
  // `addMember` é upsert (ON CONFLICT DO UPDATE do papel) — roda nos dois
  // casos de propósito, para o papel do developer voltar ao esperado mesmo se
  // alguém o tiver trocado na UI. O `owner.id` é o ATOR (ADR 0157, RN-557): o
  // caso de uso passou a recusar quem mexe no próprio papel, e aqui ator e
  // alvo são pessoas diferentes de propósito — o teto não é alcançado, e o
  // seed não ganha exceção nenhuma.
  await addWorkspaceMember.execute(
    workspace.id,
    owner.id,
    developer.id,
    'developer',
  );
  console.log(
    workspaceExistente
      ? `= workspace já existia: ${workspace.name} (${workspace.slug})`
      : `✓ workspace: ${workspace.name} (${workspace.slug})`,
  );

  const semeados: Model[] = [];
  let localModel: Model | undefined;
  // Fase 4b — Psicólogo: os dois tiers de triagem precisam de modelos
  // GENUINAMENTE diferentes; é isso que faz o custo divergir de verdade
  // no metering (ver Engine.Psychologist.Triage).
  let strongModel: Model | undefined;
  let cheapModel: Model | undefined;
  // Reseed sobre banco já semeado é o caso normal (o `bootstrap.sh` do k8s
  // roda com `BRABO_FORCE_SEED=1`), e uma correção de preço aqui — como a da
  // Vultr, que passou a valer a tarifa oficial — trocaria o número por dentro
  // do `upsert`, sem linha em `model_price_changes`. A RN-044 diz que TODA
  // troca deixa rastro, e um seed não é exceção: quem for conferir um custo
  // antigo precisa achar o momento em que o preço mudou.
  const jaGravados = new Map<string, Model>();
  for (const provider of new Set(MODEL_SEEDS.map((m) => m.provider))) {
    for (const m of await models.listByProvider(provider)) {
      jaGravados.set(`${m.provider}/${m.name}`, m);
    }
  }

  for (const modelSeed of MODEL_SEEDS) {
    const anterior = jaGravados.get(`${modelSeed.provider}/${modelSeed.name}`);
    const trocouPreco =
      anterior !== undefined &&
      (anterior.inputPricePerMillionMicros !==
        modelSeed.inputPricePerMillionMicros ||
        anterior.outputPricePerMillionMicros !==
          modelSeed.outputPricePerMillionMicros);

    // ANTES do upsert, de propósito: é o use-case auditado que compara o
    // "antes" com o "depois". Depois do upsert ele já veria os dois iguais e
    // trataria como no-op — o preço mudaria e a auditoria diria que nada
    // aconteceu.
    if (trocouPreco) {
      await updateModelPricing.execute({
        modelId: anterior.id,
        inputPricePerMillionMicros: modelSeed.inputPricePerMillionMicros,
        outputPricePerMillionMicros: modelSeed.outputPricePerMillionMicros,
        // `manual` porque o número do seed vem de doc lida por gente.
        source: 'manual',
        // Não há usuário por trás de um seed.
        changedBy: null,
      });
      console.log(
        `  ↳ preço corrigido: ${modelSeed.provider}/${modelSeed.name} ` +
          `${anterior.inputPricePerMillionMicros}/${anterior.outputPricePerMillionMicros} → ` +
          `${modelSeed.inputPricePerMillionMicros}/${modelSeed.outputPricePerMillionMicros} (auditado)`,
      );
    }

    const model = await models.upsertByProviderAndName(modelSeed);
    semeados.push(model);
    console.log(`✓ modelo: ${model.provider}/${model.name}`);
    if (model.provider === 'ollama') localModel = model;
    if (model.name === 'claude-opus-4-8') strongModel = model;
    if (model.name === 'claude-haiku-4-5-20251001') cheapModel = model;
  }
  if (!localModel) throw new Error('Modelo local não foi semeado');
  if (!strongModel || !cheapModel) {
    throw new Error('Modelos do Psicólogo (forte/barato) não foram semeados');
  }

  // A curadoria é por workspace desde o ADR 0049: sem estas linhas os modelos
  // existem no catálogo e o seletor sai VAZIO — e o binding logo abaixo seria
  // recusado por "modelo desativado". Semear é dizer "neste workspace, tudo o
  // que eu acabei de criar está ligado".
  await setModelsActive.execute({
    workspaceId: workspace.id,
    modelIds: semeados.map((m) => m.id),
    isActive: true,
    curatedBy: owner.id,
  });
  console.log(
    `✓ curadoria: ${semeados.length} modelos ativos em ${workspace.slug}`,
  );

  await setModelBinding.execute(
    'workspace',
    workspace.id,
    localModel.id,
    owner.id,
  );
  console.log(
    `✓ binding: workspace ${workspace.slug} -> ${localModel.provider}/${localModel.name}`,
  );

  const projetoExistente = (await projects.listForWorkspace(workspace.id)).find(
    (p) => p.slug === PROJETO_SEED.slug,
  );
  const project =
    projetoExistente ??
    (await createProject.execute(workspace.id, owner.id, PROJETO_SEED));
  console.log(
    projetoExistente
      ? `= projeto já existia: ${project.name} (${project.slug})`
      : `✓ projeto: ${project.name} (${project.slug})`,
  );

  // Fase 3b: persona base do Criativo (seed versionado) + binding do agente
  // pro modelo local, pra ele poder conduzir a ideação numa sessão real.
  const criativoInstr = await upsertAgentInstruction.execute(
    project.id,
    CRIATIVO_AGENT,
    CRIATIVO_INSTRUCTIONS,
  );
  console.log(
    `✓ instruções: ${CRIATIVO_AGENT} v${criativoInstr.version} (projeto ${project.slug})`,
  );
  await setModelBinding.execute(
    'agent',
    chaveDeAgente(project.id, CRIATIVO_AGENT),
    localModel.id,
    owner.id,
  );
  console.log(
    `✓ binding: agent ${CRIATIVO_AGENT} -> ${localModel.provider}/${localModel.name}`,
  );

  // Fase 4b — Psicólogo: binding próprio por tier de triagem. O agent id
  // do ctx do ToolLoop ("psicologo"/"psicologo-leve") resolve por aqui
  // via a cascata que já existe (session > agent > area > project > workspace).
  await setModelBinding.execute(
    'agent',
    chaveDeAgente(project.id, 'psicologo'),
    strongModel.id,
    owner.id,
  );
  console.log(
    `✓ binding: agent psicologo -> ${strongModel.provider}/${strongModel.name}`,
  );
  await setModelBinding.execute(
    'agent',
    chaveDeAgente(project.id, 'psicologo-leve'),
    cheapModel.id,
    owner.id,
  );
  console.log(
    `✓ binding: agent psicologo-leve -> ${cheapModel.provider}/${cheapModel.name}`,
  );

  // Ver SESSAO_SEED, no topo. Sessão não tem slug: o NOME é a identidade que
  // a releitura procura.
  const sessaoExistente = (await sessions.listForProject(project.id)).find(
    (s) => s.name === SESSAO_SEED.name,
  );

  const session =
    sessaoExistente ??
    (await createSession.execute(project.id, developer.id, SESSAO_SEED));

  // Ativação e eventos SÓ na criação, e é aqui que este arquivo teria virado
  // meio-idempotente se a releitura parasse na linha de cima: `transition`
  // para `active` numa sessão já ativa é recusado pela máquina de estados, e
  // os 5 eventos são APPEND-ONLY — cada rodada acrescentaria mais cinco a uma
  // timeline que existe para demonstrar cinco. Reencontrada a sessão, o estado
  // de demonstração já está pronto e nada há a fazer.
  if (sessaoExistente) {
    console.log(
      `= sessão já existia: ${session.id} (status=${session.status}) — ` +
        `ativação e os 5 eventos não são refeitos`,
    );
  } else {
    console.log(`✓ sessão criada: ${session.id} (status=${session.status})`);

    await transitionSession.execute(project.id, session.id, 'active');
    console.log('✓ sessão ativada');

    const eventInputs = [
      {
        type: 'session.activated',
        actor: { kind: 'system' as const, id: 'system' },
        payload: {},
      },
      {
        type: 'chat.message',
        actor: { kind: 'user' as const, id: developer.id },
        payload: { text: 'bora começar a análise do ticket #42' },
      },
      {
        type: 'agent.response',
        actor: { kind: 'agent' as const, id: 'arquiteto' },
        payload: { text: 'levantando requisitos...' },
      },
      {
        type: 'chat.message',
        actor: { kind: 'user' as const, id: developer.id },
        payload: { text: 'beleza, me avisa quando tiver o esboço' },
      },
      {
        type: 'agent.response',
        actor: { kind: 'agent' as const, id: 'arquiteto' },
        payload: { text: 'esboço pronto, aguardando revisão' },
      },
    ];

    for (const input of eventInputs) {
      const event = await appendSessionEvent.execute(
        project.id,
        session.id,
        input,
      );
      console.log(`✓ evento #${event.seq}: ${event.type}`);
    }
  }

  console.log('\nSeed concluído.');
  console.log(
    `\nPra testar o chat via curl (Ollama, projeto+sessão do seed):\n` +
      `curl -N -X POST http://localhost:3000/projects/${project.id}/sessions/${session.id}/chat \\\n` +
      `  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \\\n` +
      `  -d '{"text":"oi"}'`,
  );
  await app.close();
}

main().catch((error) => {
  console.error('Seed falhou:', error);
  process.exit(1);
});
