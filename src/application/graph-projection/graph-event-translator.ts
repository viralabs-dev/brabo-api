import type { SessionEventRepository } from '../ports/session-event-repository.port';
import type { RecordHandoffUseCase } from '../use-cases/graph/record-handoff.use-case';
import type { RecordHypothesisUseCase } from '../use-cases/graph/record-hypothesis.use-case';
import type { RecordAnamneseProfileUseCase } from '../use-cases/graph/record-anamnese-profile.use-case';
import type { RecordInteractionUseCase } from '../use-cases/graph/record-interaction.use-case';
import type { SessionEvent } from '../../domain/sessions/session-event.entity';
import type { Session } from '../../domain/sessions/session.entity';

/**
 * Os tipos que moram em `session_events` e têm tradução para o grafo. É por
 * esta lista, e só por ela, que a reprojeção (`scripts/reprojetar-grafo.ts`)
 * filtra o event log — e é por ela que o `GraphProjector` decide reler o
 * evento de origem.
 */
export const EVENTOS_DO_LOG_PROJETAVEIS: ReadonlySet<string> = new Set([
  'handoff.offered',
  'psychologist.hypothesis_proposed',
  'anamnese.profile_updated',
]);

/**
 * Os tipos que NÃO moram em `session_events`: fechar sessão é transição pura
 * da máquina de estados (`transition-session.use-case.ts`), e a fonte deles é
 * a própria linha de `sessions` em estado terminal.
 */
export const FECHAMENTOS_DE_SESSAO: ReadonlySet<string> = new Set([
  'session.closed',
  'session.closed_abnormally',
]);

/** O que a tradução de um fechamento precisa da sessão — nada além disto. */
export type SessaoFechada = Pick<
  Session,
  'id' | 'projectId' | 'createdBy' | 'nextSeq'
>;

/**
 * A tradução evento → grafo, UMA só (BRB-018, RN-569).
 *
 * Nasceu dentro do `GraphProjector` e saiu dele quando passou a existir um
 * segundo caminho que precisa dela: a reprojeção a partir do event log. Os
 * dois caminhos chamam ESTA classe, e diferem só em COMO chegam à fonte — o
 * projetor para frente relê o evento a partir de uma linha de outbox, a
 * reprojeção varre `session_events`/`sessions` por cursor. Dois tradutores
 * divergiriam, e o divergente seria justamente o que roda uma vez por ano.
 *
 * Classe simples e não `@Injectable`: o `GraphProjector` a instancia com as
 * dependências que já recebia (a superfície de injeção dele não mudou), e o
 * script a instancia fora do Nest.
 *
 * Toda gravação é `MERGE` em chave natural nos casos de uso
 * (`record-*.use-case.ts`), então traduzir o mesmo evento duas vezes converge
 * para o mesmo grafo. Uma exceção de ORDEM, e não de duplicação: o
 * `PerfilAnamnese` é snapshot (`SET proficiencia`), o último a escrever vence.
 */
export class GraphEventTranslator {
  constructor(
    private readonly sessionEvents: SessionEventRepository,
    private readonly recordHandoff: RecordHandoffUseCase,
    private readonly recordHypothesis: RecordHypothesisUseCase,
    private readonly recordAnamneseProfile: RecordAnamneseProfileUseCase,
    private readonly recordInteraction: RecordInteractionUseCase,
  ) {}

  /**
   * Projeta um evento do log. Devolve `false` quando o tipo não tem tradução
   * — quem chama decide o que dizer sobre isso; aqui nada é gravado.
   */
  async projetarEvento(event: SessionEvent): Promise<boolean> {
    switch (event.type) {
      case 'handoff.offered':
        await this.projectHandoff(event);
        return true;
      case 'psychologist.hypothesis_proposed':
        await this.projectHypothesis(event);
        return true;
      case 'anamnese.profile_updated':
        await this.projectAnamneseProfile(event);
        return true;
      default:
        return false;
    }
  }

  /**
   * Consolida a `Interacao` de uma sessão fechada: a janela inteira de seq.
   * Sessão fechada sem nenhum evento (`nextSeq === 1`) não tem janela, e nada
   * é gravado.
   */
  async projetarFechamentoDeSessao(session: SessaoFechada): Promise<void> {
    // `nextSeq` é a PRÓXIMA seq a atribuir — o último seq real é `nextSeq - 1`.
    const seqFim = session.nextSeq - 1;
    if (seqFim < 1) return;

    await this.recordInteraction.execute({
      userId: session.createdBy,
      projectId: session.projectId,
      sessionId: session.id,
      seqInicio: 1,
      seqFim,
    });
  }

  private async projectHandoff(event: SessionEvent): Promise<void> {
    const payload = event.payload as { toAgent: string };

    await this.recordHandoff.execute({
      sessionId: event.sessionId,
      seq: event.seq,
      fromAgent: event.actor.id,
      toAgent: payload.toAgent,
    });
  }

  private async projectHypothesis(event: SessionEvent): Promise<void> {
    const payload = event.payload as {
      hypothesisId: string;
      hipotese: string;
      evidenceEventIds: string[];
    };

    const evidenceSeqs = await this.resolveSeqs(
      event.sessionId,
      payload.evidenceEventIds,
    );

    await this.recordHypothesis.execute({
      hypothesisId: payload.hypothesisId,
      sessionId: event.sessionId,
      descricao: payload.hipotese,
      // Esta projeção só consome `psychologist.hypothesis_proposed` — o
      // nascimento da hipótese. `accepted`/`dismissed` (que no domínio do
      // Postgres têm vocabulário próprio) ainda não têm projeção; toda
      // hipótese que chega aqui está, do ponto de vista do grafo, `ativa`.
      // Fechar esse acompanhamento é consumo futuro, fora desta onda.
      status: 'ativa',
      evidenceSeqs,
    });
  }

  private async projectAnamneseProfile(event: SessionEvent): Promise<void> {
    const payload = event.payload as {
      userId: string;
      competency: string;
      level: string;
    };

    await this.recordAnamneseProfile.execute({
      userId: payload.userId,
      dimensao: payload.competency,
      proficiencia: payload.level,
    });
  }

  private async resolveSeqs(
    sessionId: string,
    eventIds: string[],
  ): Promise<number[]> {
    const seqs: number[] = [];
    for (const id of eventIds) {
      const event = await this.sessionEvents.findById(id);
      // Mesma checagem de pertencimento que ProposeHypothesesUseCase já faz
      // na escrita — aqui é defensivo (o dado já passou validado), não uma
      // segunda regra de negócio.
      if (event && event.sessionId === sessionId) seqs.push(event.seq);
    }
    return seqs;
  }
}
