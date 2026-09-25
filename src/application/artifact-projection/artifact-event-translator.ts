import { ArtifactFileStore } from '../ports/artifact-file-store.port';
import {
  nomeDeArquivoDoArtefato,
  pastaDoAgente,
  tipoSemPrefixo,
  tituloDoArtefato,
} from '../../domain/artifacts/artifact-projection-events';
import type { ProjectWorkspaceLocation } from '../../domain/iam/project.entity';
import type { SessionEvent } from '../../domain/sessions/session-event.entity';

/**
 * Evento `artifact.*` -> arquivo em `docs/` (ADR 0148, RN-523, RN-590).
 *
 * É a ÚNICA tradução. O `ArtifactProjector` (o caminho para frente, que chega
 * ao evento por uma linha de outbox) e `scripts/reprojetar-artefatos.ts` (que
 * chega por cursor sobre `session_events`) a chamam; nenhum dos dois sabe
 * derivar pasta, nome ou conteúdo. É o mesmo desenho do `GraphEventTranslator`
 * (RN-569), e pelo mesmo motivo: dois tradutores divergiriam, e o divergente
 * seria o que roda uma vez por ano.
 */
export class ArtifactEventTranslator {
  constructor(private readonly arquivos: ArtifactFileStore) {}

  async projetarEvento(
    local: ProjectWorkspaceLocation,
    evento: SessionEvent,
    eventType: string,
  ): Promise<void> {
    await this.arquivos.write(
      local,
      pastaDoAgente(evento.actor.id),
      nomeDeArquivoDoArtefato({
        eventType,
        seq: evento.seq,
        titulo: tituloDoArtefato(evento.payload),
      }),
      renderizar(evento, eventType),
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
