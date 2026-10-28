import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ApiToEngineClient } from '../../ports/api-to-engine-client.port';
import { SessionRepository } from '../../ports/session-repository.port';
import { TurnoNaoRetomavelError } from '../../../domain/sessions/turno-nao-retomavel.error';

export const MENSAGENS_DE_TURNO_NAO_RETOMAVEL: Record<string, string> = {
  turno_nao_interrompido:
    'Não há turno interrompido deste agente para retomar.',
  agente_sem_retomada: 'Este agente não sabe retomar um turno interrompido.',
};

/**
 * O botão "Retomar" do turno que o reinício do engine interrompeu (AT-582,
 * ADR 0226). Gesto humano, sem teto. A api só autoriza e confere a sessão: quem
 * sabe se há turno interrompido é a projeção do `Diario` no engine, e a recusa
 * dele vira 409 nomeado. A resposta é o ACEITE (RN-578); o avanço vem pelo canal.
 */
@Injectable()
export class ResumeAgentTurnUseCase {
  constructor(
    private readonly sessions: SessionRepository,
    private readonly engineClient: ApiToEngineClient,
  ) {}

  async execute(projectId: string, sessionId: string, agent: string) {
    const session = await this.sessions.findInProject(projectId, sessionId);
    if (!session) throw new NotFoundException('Sessão não encontrada');
    try {
      await this.engineClient.resumeAgentTurn(projectId, sessionId, agent);
    } catch (erro) {
      if (erro instanceof TurnoNaoRetomavelError) {
        throw new ConflictException({
          message:
            MENSAGENS_DE_TURNO_NAO_RETOMAVEL[erro.reason] ??
            'O engine recusou retomar o turno.',
          reason: erro.reason,
        });
      }
      throw erro;
    }
    return { ok: true as const };
  }
}
