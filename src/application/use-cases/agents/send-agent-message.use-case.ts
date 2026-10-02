import { Injectable, Logger } from '@nestjs/common';
import { ApiToEngineClient } from '../../ports/api-to-engine-client.port';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';
import {
  ResolverIdiomaDaRespostaUseCase,
  type IdiomaDaRespostaDaPessoa,
} from '../iam/resolver-idioma-da-resposta.use-case';
import { QueryUserContextUseCase } from '../graph/query-user-context.use-case';
import {
  TETO_DO_TEXTO,
  textoDoPerfilDoAutor,
} from '../../../domain/graph/perfil-do-autor';
import { textoDaProficienciaDoAutor } from '../../../domain/anamnese/proficiencia-do-autor';
import { ProficiencyProfileRepository } from '../../ports/proficiency-profile-repository.port';

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
 *
 * Desde a RN-680 (ADR 0196) é também quem leva ao agente os FATOS do perfil
 * deste autor neste projeto — hipóteses do Psicólogo que ele aceitou —, lidos
 * pelo caminho de leitura do grafo que já existia (`QueryUserContextUseCase`,
 * escopado ao projeto e com teto) e montados por `textoDoPerfilDoAutor`. Vão
 * ao engine como `perfilDoAutor`, que os acrescenta como mensagem de sistema
 * EFÊMERA nas chamadas do turno, como o idioma. Mesma régua de falha: grafo
 * fora do ar (ou Neo4j não configurado) vira log, e o turno segue sem eles.
 *
 * Desde a RN-696 (AT-356) o MESMO texto leva também o NÍVEL por competência
 * que a Anamnese derivou para este autor neste projeto (`proficiency_profiles`,
 * só `competência: nível`, nunca o rationale) — é por ele que o Criativo e o PO
 * calibram quantas perguntas fazem. Leitura independente da do grafo: uma
 * falha não apaga a outra.
 */
@Injectable()
export class SendAgentMessageUseCase {
  private readonly logger = new Logger(SendAgentMessageUseCase.name);

  constructor(
    private readonly engineClient: ApiToEngineClient,
    private readonly appendEvent: AppendSessionEventUseCase,
    private readonly idiomaDaResposta: ResolverIdiomaDaRespostaUseCase,
    private readonly contextoDoUsuario: QueryUserContextUseCase,
    private readonly proficiencias: ProficiencyProfileRepository,
  ) {}

  async execute(
    projectId: string,
    sessionId: string,
    agent: string,
    text: string,
    userId: string,
  ) {
    const [idioma, perfil] = await Promise.all([
      this.resolverIdioma(userId, sessionId),
      this.resolverPerfil(userId, projectId),
    ]);

    // `idiomaAlvo`/`origem` no `chat.message` são para a MEDIÇÃO (AT-082): o
    // evento é imutável e diz, para sempre, o que foi pedido ao modelo
    // naquele turno. Ausentes quando a resolução falhou — é o mesmo "sem
    // orientação" que o engine recebe.
    const mensagem = await this.appendEvent.execute(projectId, sessionId, {
      type: 'chat.message',
      actor: { kind: 'user', id: userId },
      payload: {
        text,
        ...(idioma ? { idiomaAlvo: idioma.idioma, origem: idioma.origem } : {}),
        // RN-680: QUANTOS fatos do perfil foram ao modelo neste turno — o
        // texto não, que já mora no grafo e no aceite de cada hipótese.
        ...(perfil && perfil.quantos > 0
          ? { fatosDoPerfil: perfil.quantos }
          : {}),
      },
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
      perfil?.texto ?? null,
    );

    return { ok: true as const, mensagemId: mensagem.id, ...entrega };
  }

  private async resolverPerfil(
    userId: string,
    projectId: string,
  ): Promise<{ texto: string; quantos: number } | null> {
    const [fatos, proficiencia] = await Promise.all([
      this.resolverFatos(userId, projectId),
      this.resolverProficiencia(userId, projectId),
    ]);
    const partes = [fatos?.texto, proficiencia].filter(
      (t): t is string => typeof t === 'string' && t !== '',
    );
    if (partes.length === 0) return null;
    const texto = partes.join('\n\n');
    return {
      texto:
        texto.length > TETO_DO_TEXTO
          ? `${texto.slice(0, TETO_DO_TEXTO - 1)}…`
          : texto,
      quantos: fatos?.quantos ?? 0,
    };
  }

  // RN-696: melhor esforço, como os fatos — falha vira log, o turno segue.
  private async resolverProficiencia(
    userId: string,
    projectId: string,
  ): Promise<string | null> {
    try {
      const perfis = await this.proficiencias.listByUser(projectId, userId);
      return textoDaProficienciaDoAutor(perfis);
    } catch (erro) {
      this.logger.warn(
        `proficiência do autor não lida para o projeto ${projectId}: o turno segue sem ela (${erro instanceof Error ? erro.message : String(erro)})`,
      );
      return null;
    }
  }

  private async resolverFatos(
    userId: string,
    projectId: string,
  ): Promise<{ texto: string; quantos: number } | null> {
    try {
      const contexto = await this.contextoDoUsuario.execute({
        userId,
        projectId,
      });
      const texto = textoDoPerfilDoAutor(contexto.facts, contexto.factsTotal);
      return texto ? { texto, quantos: contexto.facts.length } : null;
    } catch (erro) {
      this.logger.warn(
        `fatos do perfil não lidos para o projeto ${projectId}: o turno segue sem eles (${erro instanceof Error ? erro.message : String(erro)})`,
      );
      return null;
    }
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
