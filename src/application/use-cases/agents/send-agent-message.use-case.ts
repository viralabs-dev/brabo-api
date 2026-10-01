import { Injectable, Logger } from '@nestjs/common';
import { ApiToEngineClient } from '../../ports/api-to-engine-client.port';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';
import {
  ResolverIdiomaDaRespostaUseCase,
  type IdiomaDaRespostaDaPessoa,
} from '../iam/resolver-idioma-da-resposta.use-case';

/**
 * Mensagem do usuário para um agente ATIVO na sessão (Fase 3b). Grava o
 * `chat.message` (durável no event log mesmo que o engine esteja fora do ar)
 * e então roteia pro engine, que roda o turno no harness e narra a resposta
 * (`agent.response` + artefatos). Sessões SEM agente ativo continuam no
 * SendChatMessageUseCase (chat humano stateless) — este caminho é só pros
 * agentes conversacionais.
 *
 * Desde a RN-622 (AT-164) é também quem resolve o idioma em que o agente
 * responde a ESTE autor (`ResolverIdiomaDaRespostaUseCase`, RN-618 — o
 * override dele na sessão vence a conta, que vence o detectado confirmado, que
 * vence a interface) e o manda ao engine como `idiomaDaResposta`. O engine o
 * põe no fim de cada chamada de LLM do turno como mensagem de sistema
 * efêmera. Resolver é MELHOR ESFORÇO: a falha vira log e o turno segue sem
 * orientação — nunca derruba a mensagem. O chat humano sem agente fica fora
 * (AT-169 resposta 3).
 *
 * Desde a RN-673 (ADR 0191) a mensagem que chega com turno em curso não é mais
 * 409 `turno_em_andamento`: o engine a põe na FILA do agente e a lê, com as
 * outras que chegarem, no fim do turno. A resposta diz qual dos dois houve
 * (`entrega: 'lida' | 'enfileirada'`) e devolve o `mensagemId` — o id do
 * `chat.message` gravado aqui, que é o que cancela a mensagem pendente.
 */
@Injectable()
export class SendAgentMessageUseCase {
  private readonly logger = new Logger(SendAgentMessageUseCase.name);

  constructor(
    private readonly engineClient: ApiToEngineClient,
    private readonly appendEvent: AppendSessionEventUseCase,
    private readonly idiomaDaResposta: ResolverIdiomaDaRespostaUseCase,
  ) {}

  async execute(
    projectId: string,
    sessionId: string,
    agent: string,
    text: string,
    userId: string,
  ) {
    const idioma = await this.resolverIdioma(userId, sessionId);

    // `idiomaAlvo`/`origem` no `chat.message` são para a MEDIÇÃO (AT-082): o
    // evento é imutável e diz, para sempre, o que foi pedido ao modelo
    // naquele turno. Ausentes quando a resolução falhou — é o mesmo "sem
    // orientação" que o engine recebe.
    const mensagem = await this.appendEvent.execute(projectId, sessionId, {
      type: 'chat.message',
      actor: { kind: 'user', id: userId },
      payload: idioma
        ? { text, idiomaAlvo: idioma.idioma, origem: idioma.origem }
        : { text },
    });

    // RN-673: o id do `chat.message` vai junto — com turno em curso a
    // mensagem entra na FILA do agente, e é por esse id que ela é marcada
    // entregue ou cancelada no log.
    const entrega = await this.engineClient.sendAgentMessage(
      projectId,
      sessionId,
      agent,
      text,
      idioma?.idioma ?? null,
      mensagem.id,
    );

    return { ok: true as const, mensagemId: mensagem.id, ...entrega };
  }

  private async resolverIdioma(
    userId: string,
    sessionId: string,
  ): Promise<IdiomaDaRespostaDaPessoa | null> {
    try {
      return await this.idiomaDaResposta.execute(userId, sessionId);
    } catch (erro) {
      this.logger.warn(
        `idioma da resposta não resolvido para a sessão ${sessionId}: o turno segue sem orientação (${erro instanceof Error ? erro.message : String(erro)})`,
      );
      return null;
    }
  }
}
