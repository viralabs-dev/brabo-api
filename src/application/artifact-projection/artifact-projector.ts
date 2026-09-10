import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { OutboxRepository } from '../ports/outbox-repository.port';
import { SessionEventRepository } from '../ports/session-event-repository.port';
import { ProjectRepository } from '../ports/project-repository.port';
import { ArtifactFileStore } from '../ports/artifact-file-store.port';
import {
  ARTIFACT_PROJECTION_AGGREGATE_TYPE,
  nomeDeArquivoDoArtefato,
  pastaDoAgente,
  tipoSemPrefixo,
  tituloDoArtefato,
} from '../../domain/artifacts/artifact-projection-events';
import type { OutboxEvent } from '../../domain/shared/outbox-event.entity';
import type { SessionEvent } from '../../domain/sessions/session-event.entity';

/** Mesmo tamanho de lote que `GraphProjector` e `Engine.Outbox.Drain.run_once/0`. */
const BATCH_LIMIT = 50;

/**
 * A pasta `docs/` do projeto, escrita a partir do event log (ADR 0148,
 * RN-523).
 *
 * É PROJEÇÃO DERIVADA, no sentido estrito que o ADR 0101 já deu ao grafo: a
 * fonte é o event log, esta pasta pode ser apagada inteira e reconstruída, e
 * NADA no produto lê dela para decidir coisa alguma. Ela existe para uma
 * pessoa abrir no editor e ver o que os agentes produziram — que é o único
 * lugar onde essa memória hoje não chega.
 *
 * ## O molde é o `GraphProjector`, peça por peça
 *
 * Poller próprio (`setInterval` com `.unref()`, limpo em `onModuleDestroy`),
 * `drainOnce()` público e independente do timer (é o que os testes chamam),
 * flag `draining` contra ciclos sobrepostos, lote de 50, `markProcessed`
 * SOMENTE após sucesso. Não há fila de jobs do lado api — o Oban do engine dá
 * "um job por vez" de graça, e aqui isso é reimplementado à mão.
 *
 * ## A projeção nunca derruba a fonte
 *
 * Nenhum throw escapa daqui: `onModuleInit` chama `void this.drainOnce()`, e
 * cada item falha isolado, fica logado e permanece `processed_at IS NULL` para
 * o ciclo seguinte. Disco cheio, permissão negada ou pasta inalcançável não
 * podem impedir um artefato de ser EMITIDO — o evento já está no event log
 * quando esta classe roda, e é ele que vale. A tabela não tem `attempts` nem
 * dead-letter: o retry é implícito e infinito, exatamente como o do grafo.
 *
 * Diferente do grafo, não há aqui um equivalente ao `GraphUnavailableError`
 * que faça o ciclo inteiro parar: uma falha de escrita costuma ser do ITEM
 * (nome estranho, artefato de um projeto cuja pasta sumiu), não do destino, e
 * parar o lote por causa de um item bloquearia todos os outros atrás dele.
 */
@Injectable()
export class ArtifactProjector implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ArtifactProjector.name);
  private timer?: NodeJS.Timeout;
  private draining = false;

  constructor(
    private readonly outbox: OutboxRepository,
    private readonly sessionEvents: SessionEventRepository,
    private readonly projects: ProjectRepository,
    private readonly arquivos: ArtifactFileStore,
  ) {}

  onModuleInit(): void {
    const intervalMs = Number(
      process.env.ARTIFACT_PROJECTOR_INTERVAL_MS ?? 2000,
    );
    this.timer = setInterval(() => void this.drainOnce(), intervalMs);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async drainOnce(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      const rows = await this.outbox.listUnprocessed(
        ARTIFACT_PROJECTION_AGGREGATE_TYPE,
        BATCH_LIMIT,
      );

      for (const row of rows) {
        try {
          await this.project(row);
          await this.outbox.markProcessed(row.id);
        } catch (error) {
          this.logger.error(
            `Falha ao projetar artefato da outbox ${row.id} (${row.eventType}): ` +
              `${describeError(error)} — item permanece para retry.`,
          );
        }
      }
    } finally {
      this.draining = false;
    }
  }

  /**
   * `aggregateId` é o PROJETO, não a sessão: a pasta é do projeto, e o evento
   * de origem só carrega `sessionId`. Resolver projeto a partir da sessão
   * custaria uma consulta a mais em toda projeção para responder algo que
   * `AppendSessionEventUseCase` já tinha em mãos na hora de gravar a linha.
   */
  private async project(row: OutboxEvent): Promise<void> {
    const { eventId } = row.payload as { eventId: string };
    const evento = await this.sessionEvents.findById(eventId);
    if (!evento) {
      // Mesma degradação do GraphProjector: o item é marcado processado pelo
      // chamador, porque retentar para sempre um evento que não existe mais
      // não teria efeito nenhum.
      this.logger.warn(
        `Outbox ${row.id} aponta pro evento ${eventId}, que não existe mais no event log — pulando.`,
      );
      return;
    }

    const projeto = await this.projects.findById(row.aggregateId);
    if (!projeto) {
      this.logger.warn(
        `Outbox ${row.id} referencia o projeto ${row.aggregateId}, que não existe mais — pulando.`,
      );
      return;
    }

    await this.arquivos.write(
      projeto,
      pastaDoAgente(evento.actor.id),
      nomeDeArquivoDoArtefato({
        eventType: row.eventType,
        seq: evento.seq,
        titulo: tituloDoArtefato(evento.payload),
      }),
      renderizar(evento, row.eventType),
    );
  }
}

/**
 * O Markdown do artefato.
 *
 * Cabeçalho com o que a pasta sozinha não diz (tipo, agente, quando, e o `seq`
 * que liga de volta ao event log) e o payload como bloco JSON. NÃO tenta
 * formatar cada um dos treze tipos: um renderizador por tipo seria treze
 * lugares para envelhecer quando um schema mudar, e o que esta pasta precisa
 * entregar é o CONTEÚDO legível e rastreável, não uma diagramação. Um formato
 * mais rico por tipo é decisão própria, quando alguém tiver uma leitura real
 * pedindo por ela.
 */
function renderizar(evento: SessionEvent, eventType: string): string {
  const titulo = tituloDoArtefato(evento.payload) ?? tipoSemPrefixo(eventType);
  return [
    `# ${titulo}`,
    '',
    `- **Tipo:** \`${tipoSemPrefixo(eventType)}\``,
    `- **Agente:** ${evento.actor.id}`,
    `- **Quando:** ${evento.createdAt.toISOString()}`,
    `- **Evento:** \`${evento.id}\` (seq ${evento.seq})`,
    '',
    '> Arquivo GERADO a partir do event log (ADR 0148). A fonte é o evento',
    '> acima — editar aqui não muda nada, e a próxima projeção sobrescreve.',
    '',
    '```json',
    JSON.stringify(evento.payload, null, 2),
    '```',
    '',
  ].join('\n');
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
