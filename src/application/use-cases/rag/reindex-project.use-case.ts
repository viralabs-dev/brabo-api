import { Injectable, NotFoundException } from '@nestjs/common';
import { ProjectRepository } from '../../ports/project-repository.port';
import { SessionRepository } from '../../ports/session-repository.port';
import {
  IndexProjectDocsUseCase,
  type IndexDocsReport,
} from './index-project-docs.use-case';
import { IndexSessionUseCase } from './index-session.use-case';

export interface ReindexProjectReport {
  docs: IndexDocsReport;
  sessions: {
    total: number;
    indexed: number;
    chunksCreated: number;
  };
  /** `false` se QUALQUER rodada (docs ou alguma sessão) não conseguiu vetorizar. */
  embeddingAvailable: boolean;
  embeddingReason?: string;
}

/**
 * O "Reindexar agora" do painel do Chat RAG (handoff, `designs/Brabo
 * Chat.dc.html`) — PROGRAMA 28, Onda 4 (RN-231..233, ADR 0080).
 *
 * Roda os TRÊS escopos honestos (RN-219): `docs`/`adr` via
 * `IndexProjectDocsUseCase` (uma varredura), `session` rodando
 * `IndexSessionUseCase` para CADA sessão do projeto — sessão sem
 * `chat.message`/`agent.response` nenhum simplesmente não gera chunk, e não
 * é erro (uma sessão `created` sem conversa ainda não tem o que indexar).
 *
 * Não há AGENDAMENTO nem watcher aqui: esta é a operação MANUAL, disparada
 * por quem clica "Reindexar agora" (Onda 5) ou por um script de operação —
 * reindexação automática por push/evento é trabalho declarado como FORA
 * desta onda (ADR 0079: "reindexar é responsabilidade de quem escrever o
 * pipeline", e o pipeline aqui é sob demanda, não reativo).
 *
 * ## Por que `local` (ADR 0113/RN-455) NÃO entra aqui
 *
 * Este caso de uso reindexa lendo de uma fonte que o SERVIDOR consegue
 * revisitar — o repositório do projeto (`docs`/`adr`) e o event log
 * (`session`). O escopo `local` não tem fonte nenhuma para revisitar: o
 * texto vive só no NAVEGADOR de quem anexou, e o servidor nunca guardou o
 * caminho de host original. Chamar `deleteByScope(projectId, 'local')`
 * aqui apagaria a referência anexada sem ter como recriá-la — a mesma
 * classe de bug que apagaria dado do usuário num clique de "Reindexar"
 * genérico. `IndexLocalFolderUseCase` é o ÚNICO caminho que escreve nesse
 * escopo, e reanexar a pasta (novo upload) É o mecanismo de resincronizar
 * — não este botão. NÃO "corrija" isto sem reler o ADR 0113 inteiro.
 */
@Injectable()
export class ReindexProjectUseCase {
  constructor(
    private readonly projects: ProjectRepository,
    private readonly sessions: SessionRepository,
    private readonly indexDocs: IndexProjectDocsUseCase,
    private readonly indexSession: IndexSessionUseCase,
  ) {}

  async execute(projectId: string): Promise<ReindexProjectReport> {
    const project = await this.projects.findById(projectId);
    if (!project)
      throw new NotFoundException(`Projeto não encontrado: ${projectId}`);

    const docs = await this.indexDocs.execute(projectId);

    const sessoes = await this.sessions.listForProject(projectId);
    let sessoesIndexadas = 0;
    let chunksDeSessao = 0;
    let sessaoSemVetorMotivo: string | undefined;
    let algumaSessaoSemVetor = false;

    for (const sessao of sessoes) {
      const relatorio = await this.indexSession.execute(projectId, sessao.id);
      if (relatorio.chunksCreated > 0) sessoesIndexadas++;
      chunksDeSessao += relatorio.chunksCreated;
      if (!relatorio.embedding.available) {
        algumaSessaoSemVetor = true;
        sessaoSemVetorMotivo ??= relatorio.embedding.reason;
      }
    }

    const embeddingAvailable =
      docs.embedding.available && !algumaSessaoSemVetor;

    return {
      docs,
      sessions: {
        total: sessoes.length,
        indexed: sessoesIndexadas,
        chunksCreated: chunksDeSessao,
      },
      embeddingAvailable,
      embeddingReason: embeddingAvailable
        ? undefined
        : (docs.embedding.reason ?? sessaoSemVetorMotivo),
    };
  }
}
