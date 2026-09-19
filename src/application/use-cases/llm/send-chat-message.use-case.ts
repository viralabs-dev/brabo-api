import { Injectable, NotFoundException, Optional } from '@nestjs/common';
import { ulid } from 'ulid';
import { UnitOfWork } from '../../ports/unit-of-work.port';
import { SessionRepository } from '../../ports/session-repository.port';
import { SessionEventRepository } from '../../ports/session-event-repository.port';
import { OutboxRepository } from '../../ports/outbox-repository.port';
import { SessionChannelNotifier } from '../../ports/session-channel-notifier.port';
import { ModelRepository } from '../../ports/model-repository.port';
import { UserCredentialRepository } from '../../ports/user-credential-repository.port';
import { EncryptionService } from '../../ports/encryption.port';
import { LLMProviderRegistry } from '../../ports/llm-provider-registry.port';
import { TokenEstimator } from '../../ports/token-estimator.port';
import { ResolveModelBindingUseCase } from './resolve-model-binding.use-case';
import { CheckBudgetGateUseCase } from './check-budget-gate.use-case';
import { RecordLlmUsageUseCase } from './record-llm-usage.use-case';
import { preferenciaEnviada } from '../../../domain/llm/routing-preference';
import { calculateCostMicros } from '../../../domain/llm/cost-calculator';
import type { Actor } from '../../../domain/sessions/session-event.entity';
import {
  ConversaEmSessaoEncerradaError,
  garantirQueSessaoAceitaEvento,
} from '../../../domain/sessions/conversa-em-sessao-encerrada';
import { conflitoDeSessaoEncerrada } from '../sessions/append-session-event.use-case';

export interface SendChatMessageInput {
  projectId: string;
  sessionId: string;
  actor: Actor;
  text: string;
  agentId?: string;
}

export type ChatSseEvent =
  | { type: 'delta'; text: string }
  | {
      type: 'done';
      inputTokens: number;
      outputTokens: number;
      costMicros: number;
      estimated: boolean;
    }
  | { type: 'error'; message: string }
  | { type: 'metering_failed'; message: string };

@Injectable()
export class SendChatMessageUseCase {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly sessions: SessionRepository,
    private readonly sessionEvents: SessionEventRepository,
    private readonly outbox: OutboxRepository,
    private readonly models: ModelRepository,
    private readonly credentials: UserCredentialRepository,
    private readonly encryption: EncryptionService,
    private readonly llmProviders: LLMProviderRegistry,
    private readonly tokenEstimator: TokenEstimator,
    private readonly resolveModelBinding: ResolveModelBindingUseCase,
    private readonly checkBudgetGate: CheckBudgetGateUseCase,
    private readonly recordLlmUsage: RecordLlmUsageUseCase,
    // AT-157: avisa o canal da sessão; opcional para quem monta à mão.
    @Optional() private readonly canal?: SessionChannelNotifier,
  ) {}

  async *execute(input: SendChatMessageInput): AsyncGenerator<ChatSseEvent> {
    const startedAt = Date.now();

    // 1) Grava a mensagem do usuário PRIMEIRO, antes de qualquer chamada
    //    ao provider — se a sessão não existir, propaga 404 sem custo
    //    nenhum envolvido.
    await this.unitOfWork.runInTransaction(async () => {
      const reservado = await this.sessions.incrementSeq(
        input.projectId,
        input.sessionId,
      );
      if (reservado === null) {
        throw new NotFoundException('Sessão não encontrada');
      }
      // RN-581: este caminho grava `chat.message` sem passar pelo funil
      // `AppendSessionEventUseCase`, então a trava do estado tem de estar aqui
      // também — senão o chat humano seria a porta que o funil fechou.
      try {
        garantirQueSessaoAceitaEvento(
          reservado.status,
          'chat.message',
          input.actor,
        );
      } catch (error) {
        if (error instanceof ConversaEmSessaoEncerradaError) {
          throw conflitoDeSessaoEncerrada(error);
        }
        throw error;
      }
      const seq = reservado.seq;

      await this.sessionEvents.append({
        id: ulid(),
        sessionId: input.sessionId,
        seq,
        type: 'chat.message',
        actor: input.actor,
        payload: { text: input.text },
      });
      await this.outbox.append({
        aggregateType: 'session',
        aggregateId: input.sessionId,
        eventType: 'session_event.appended',
        payload: { seq, type: 'chat.message' },
      });
      this.canal?.eventAppended(
        input.sessionId,
        'chat.message',
        input.actor.id,
      );
    });

    // 2) Resolve o binding + modelo. Sem isso, nenhuma chamada é feita.
    const binding = await this.resolveModelBinding.execute({
      projectId: input.projectId,
      sessionId: input.sessionId,
      agentId: input.agentId,
    });
    if (!binding) {
      yield {
        type: 'error',
        message: 'Nenhum modelo vinculado para esta sessão',
      };
      return;
    }
    const model = await this.models.findById(binding.modelId);
    if (!model) {
      yield { type: 'error', message: 'Modelo vinculado não encontrado' };
      return;
    }

    // 3) Checagem de budget FAIL-CLOSED — recusa antes de chamar o provider.
    const gate = await this.checkBudgetGate.execute(
      input.projectId,
      input.sessionId,
      input.agentId,
    );
    if (gate.blocked) {
      yield { type: 'error', message: gate.reason ?? 'Budget excedido' };
      return;
    }

    // 4) Resolve credencial (pula pra ollama).
    let apiKey: string | undefined;
    if (model.provider !== 'ollama') {
      const secret = await this.credentials.findSecretByUserAndProvider(
        input.actor.id,
        model.provider,
      );
      if (!secret) {
        yield {
          type: 'error',
          message: `Nenhuma credencial cadastrada para ${model.provider}`,
        };
        return;
      }
      apiKey = this.encryption.decrypt(secret);
    }

    // 5) Chama o provider e repassa os deltas em tempo real.
    const provider = this.llmProviders.get(model.provider);
    // O critério do binding VENCEDOR, e só se este provider o declara — é o
    // que vai ao fio e o que congela no metering (ADR 0166, RN-583).
    const routingPreference = preferenciaEnviada(
      binding.routingPreference,
      provider.capabilities,
    );
    let fullText = '';
    let inputTokens = 0;
    let outputTokens = 0;
    let estimated = false;
    // Só um hub preenche isto; nos providers diretos fica null (Fase 9b).
    let upstreamProvider: string | null = null;
    let streamError: string | null = null;

    try {
      for await (const chunk of provider.chat(
        [{ role: 'user', content: input.text }],
        {
          model: model.name,
          apiKey,
          ...(routingPreference ? { routingPreference } : {}),
        },
      )) {
        if (chunk.type === 'text_delta') {
          fullText += chunk.text;
          yield { type: 'delta', text: chunk.text };
        } else if (chunk.type === 'usage') {
          inputTokens = chunk.inputTokens;
          outputTokens = chunk.outputTokens;
          estimated = chunk.estimated;
          upstreamProvider = chunk.upstreamProvider ?? null;
        } else if (chunk.type === 'error') {
          streamError = chunk.message;
        }
      }
    } catch (error) {
      streamError = (error as Error).message;
    }

    // 6) Metering OBRIGATÓRIO — roda mesmo com erro do provider (o
    //    generator chega aqui de qualquer forma, dado que o loop acima
    //    não propaga exceção pra fora do try).
    if (inputTokens === 0 && outputTokens === 0) {
      inputTokens = this.tokenEstimator.count(input.text);
      outputTokens = this.tokenEstimator.count(fullText);
      estimated = true;
    }
    const costMicros = calculateCostMicros(
      inputTokens,
      outputTokens,
      model.inputPricePerMillionMicros,
      model.outputPricePerMillionMicros,
    );
    const latencyMs = Date.now() - startedAt;
    const assistantActor: Actor = { kind: 'agent', id: model.name };

    try {
      await this.unitOfWork.runInTransaction(async () => {
        await this.recordLlmUsage.execute({
          projectId: input.projectId,
          sessionId: input.sessionId,
          actor: assistantActor,
          provider: model.provider,
          modelId: model.id,
          modelName: model.name,
          inputTokens,
          outputTokens,
          estimated,
          costMicros,
          // Congela o preço junto do custo: sem isso o `cost_micros` de ontem é
          // um número sem procedência quando o preço mudar (RN-044).
          inputPricePerMillionMicros: model.inputPricePerMillionMicros,
          outputPricePerMillionMicros: model.outputPricePerMillionMicros,
          latencyMs,
          bindingOrigin: binding.origin,
          upstreamProvider,
          routingPreference,
        });

        // A resposta de um turno que COMEÇOU com a sessão aberta entra mesmo
        // que ela tenha fechado no meio: o ator é o modelo, não um agente
        // conversacional, e o gasto já foi feito e medido — recusar só
        // apagaria do log o que o metering registrou (RN-581).
        const reservado = await this.sessions.incrementSeq(
          input.projectId,
          input.sessionId,
        );
        const seq = reservado?.seq ?? null;
        if (seq !== null) {
          await this.sessionEvents.append({
            id: ulid(),
            sessionId: input.sessionId,
            seq,
            type: 'agent.response',
            actor: assistantActor,
            // RN-175: `modelName` no payload, como nos `agent.response` do
            // engine. Aqui o `actor.id` JÁ é o nome do modelo (chat sem agente
            // ativo: quem responde é o modelo), mas a tela lê o modelo do
            // PAYLOAD — depender do ator seria uma segunda regra, e ela
            // deixaria de valer no dia em que este caminho ganhasse um agente.
            payload: {
              text: fullText,
              estimated,
              error: streamError,
              modelName: model.name,
            },
          });
          await this.outbox.append({
            aggregateType: 'session',
            aggregateId: input.sessionId,
            eventType: 'session_event.appended',
            payload: { seq, type: 'agent.response' },
          });
          this.canal?.eventAppended(
            input.sessionId,
            'agent.response',
            assistantActor.id,
          );
        }
      });
    } catch {
      // A resposta já foi transmitida ao cliente (SSE não tem volta) —
      // avisar explicitamente que o registro falhou em vez de fingir
      // sucesso com um `done`.
      yield {
        type: 'metering_failed',
        message: 'Resposta gerada, mas o registro de uso falhou',
      };
      return;
    }

    if (streamError) {
      yield {
        type: 'error',
        message: `Falha ao consultar o provedor: ${streamError}`,
      };
    } else {
      yield { type: 'done', inputTokens, outputTokens, costMicros, estimated };
    }
  }
}
