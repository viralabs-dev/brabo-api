/**
 * Seed de demonstração: 1 workspace, 2 usuários com papéis distintos,
 * 1 projeto e 1 sessão com 5 eventos.
 *
 * Roda os use cases reais via um application context do Nest (sem
 * HTTP, sem guards — guards só interceptam a pipeline HTTP) para
 * exercitar o mesmo caminho de código usado pela API (outbox incluso).
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
import type { Model } from '../domain/llm/model.entity';
import { SetModelBindingUseCase } from '../application/use-cases/llm/set-model-binding.use-case';
import { UpsertAgentInstructionUseCase } from '../application/use-cases/agents/upsert-agent-instruction.use-case';
import {
  CRIATIVO_AGENT,
  CRIATIVO_INSTRUCTIONS,
} from './seeds/criativo-instructions';

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
  // curadoria através deste seed até alguém confirmar um endpoint de preço.
  // NVIDIA não publica preço de produção (a doc oficial aponta pra contato
  // comercial) — os valores abaixo são uma ESTIMATIVA por comparação com
  // modelos equivalentes noutros providers (não uma cotação oficial), com
  // `manualPricing: true` pra o sync nunca sobrescrever sem decisão
  // explícita. Corrigir assim que houver uma fonte oficial.
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
  // `model`). Preço da Bitdeer em si não foi encontrado (a página de preço
  // renderiza via JS) — os valores são ESTIMATIVA por comparação com o
  // mesmo modelo/família noutros providers, com `manualPricing: true`.
  // Corrigir assim que houver uma fonte oficial da própria Bitdeer.
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
  // sem confirmação de tool calling. Preço ESTIMADO — Vultr não publica
  // preço por modelo em doc acessível nesta sessão.
  {
    provider: 'vultr',
    name: 'kimi-k2-instruct',
    displayName: 'Kimi K2 Instruct (Vultr)',
    inputPricePerMillionMicros: 900_000,
    outputPricePerMillionMicros: 3_500_000,
    supportsToolCalling: true,
    manualPricing: true,
  },
  {
    provider: 'vultr',
    name: 'llama-3.3-70b-instruct-fp8',
    displayName: 'Llama 3.3 70B Instruct FP8 (Vultr)',
    inputPricePerMillionMicros: 400_000,
    outputPricePerMillionMicros: 400_000,
    supportsToolCalling: false,
    manualPricing: true,
  },
  {
    provider: 'vultr',
    name: 'deepseek-r1-distill-llama-70b',
    displayName: 'DeepSeek R1 Distill Llama 70B (Vultr)',
    inputPricePerMillionMicros: 400_000,
    outputPricePerMillionMicros: 400_000,
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
  const setModelBinding = app.get(SetModelBindingUseCase);
  const upsertAgentInstruction = app.get(UpsertAgentInstructionUseCase);

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

  const workspace = await createWorkspace.execute(owner.id, {
    name: 'Acme Corp',
    slug: 'acme-corp',
  });
  await addWorkspaceMember.execute(workspace.id, developer.id, 'developer');
  console.log(`✓ workspace: ${workspace.name} (${workspace.slug})`);

  let localModel: Model | undefined;
  // Fase 4b — Psicólogo: os dois tiers de triagem precisam de modelos
  // GENUINAMENTE diferentes; é isso que faz o custo divergir de verdade
  // no metering (ver Engine.Psychologist.Triage).
  let strongModel: Model | undefined;
  let cheapModel: Model | undefined;
  for (const modelSeed of MODEL_SEEDS) {
    const model = await models.upsertByProviderAndName(modelSeed);
    console.log(`✓ modelo: ${model.provider}/${model.name}`);
    if (model.provider === 'ollama') localModel = model;
    if (model.name === 'claude-opus-4-8') strongModel = model;
    if (model.name === 'claude-haiku-4-5-20251001') cheapModel = model;
  }
  if (!localModel) throw new Error('Modelo local não foi semeado');
  if (!strongModel || !cheapModel) {
    throw new Error('Modelos do Psicólogo (forte/barato) não foram semeados');
  }

  await setModelBinding.execute(
    'workspace',
    workspace.id,
    localModel.id,
    owner.id,
  );
  console.log(
    `✓ binding: workspace ${workspace.slug} -> ${localModel.provider}/${localModel.name}`,
  );

  const project = await createProject.execute(workspace.id, owner.id, {
    name: 'Core API',
    slug: 'core-api',
  });
  console.log(`✓ projeto: ${project.name} (${project.slug})`);

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
    CRIATIVO_AGENT,
    localModel.id,
    owner.id,
  );
  console.log(
    `✓ binding: agent ${CRIATIVO_AGENT} -> ${localModel.provider}/${localModel.name}`,
  );

  // Fase 4b — Psicólogo: binding próprio por tier de triagem. O agent id
  // do ctx do ToolLoop ("psicologo"/"psicologo-leve") resolve por aqui
  // via a cascata que já existe (session > agent > project > workspace).
  await setModelBinding.execute('agent', 'psicologo', strongModel.id, owner.id);
  console.log(
    `✓ binding: agent psicologo -> ${strongModel.provider}/${strongModel.name}`,
  );
  await setModelBinding.execute(
    'agent',
    'psicologo-leve',
    cheapModel.id,
    owner.id,
  );
  console.log(
    `✓ binding: agent psicologo-leve -> ${cheapModel.provider}/${cheapModel.name}`,
  );

  const session = await createSession.execute(project.id, developer.id);
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
