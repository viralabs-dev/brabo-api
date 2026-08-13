import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SessionEventRepository } from '../../ports/session-event-repository.port';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';
import { SendAgentMessageUseCase } from './send-agent-message.use-case';

interface StructuredQuestion {
  id: string;
  label: string;
  type?: string;
  options?: string[];
}

/**
 * Submissão do formulário de `chat.structured_question` (RN-162): o
 * Criativo (via `ask_structured_questions`) pode pedir várias respostas de
 * uma vez, e o usuário responde por um formulário em vez de texto livre
 * item por item.
 *
 * Grava `chat.structured_question_answered` (imutável, referenciando o
 * `questionSetId`) e então REUSA `SendAgentMessageUseCase` — as respostas
 * viram uma mensagem `chat.message` concatenada ("1. {label}: {resposta}"),
 * que o agente lê no próximo turno como uma mensagem normal do usuário. Não
 * existe um canal separado de "o agente lê a resposta estruturada": o
 * caminho de entrada de mensagem já existente é o único.
 */
@Injectable()
export class AnswerStructuredQuestionUseCase {
  constructor(
    private readonly sessionEvents: SessionEventRepository,
    private readonly appendEvent: AppendSessionEventUseCase,
    private readonly sendAgentMessage: SendAgentMessageUseCase,
  ) {}

  async execute(
    projectId: string,
    sessionId: string,
    agent: string,
    questionSetId: string,
    answers: Record<string, string>,
    userId: string,
  ) {
    const questionSetEvent = await this.sessionEvents.findById(questionSetId);
    if (
      !questionSetEvent ||
      questionSetEvent.sessionId !== sessionId ||
      questionSetEvent.type !== 'chat.structured_question'
    ) {
      throw new NotFoundException('Conjunto de perguntas não encontrado');
    }

    const questions =
      (questionSetEvent.payload as { questions?: StructuredQuestion[] })
        .questions ?? [];

    // O evento é IMUTÁVEL — a única forma de recusar reenvio é aqui, na
    // entrada, olhando se já existe uma resposta para este `questionSetId`
    // (mesmo raciocínio de `EmitArtifact`/`ArtifactDedupe` para
    // `business_rule`: RN-096 já estabeleceu que duplicata exata é recusada
    // antes de gravar).
    const respostasExistentes = await this.sessionEvents.listByTypeInSession(
      sessionId,
      'chat.structured_question_answered',
    );
    const jaRespondido = respostasExistentes.some(
      (e) =>
        (e.payload as { questionSetId?: unknown })?.questionSetId ===
        questionSetId,
    );
    if (jaRespondido) {
      throw new ConflictException(
        'Este conjunto de perguntas já foi respondido',
      );
    }

    const faltando = questions.filter(
      (q) => typeof answers[q.id] !== 'string' || answers[q.id].trim() === '',
    );
    if (faltando.length > 0) {
      throw new BadRequestException(
        `Resposta faltando para: ${faltando.map((q) => q.id).join(', ')}`,
      );
    }

    await this.appendEvent.execute(projectId, sessionId, {
      type: 'chat.structured_question_answered',
      actor: { kind: 'user', id: userId },
      payload: { questionSetId, answers },
    });

    const texto = questions
      .map((q, i) => `${i + 1}. ${q.label}: ${answers[q.id]}`)
      .join('\n');

    await this.sendAgentMessage.execute(
      projectId,
      sessionId,
      agent,
      texto,
      userId,
    );

    return { ok: true as const };
  }
}
