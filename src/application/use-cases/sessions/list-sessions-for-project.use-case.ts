import { Injectable } from '@nestjs/common';
import { SessionRepository } from '../../ports/session-repository.port';
import { RepoBootstrapRepository } from '../../ports/repo-bootstrap-repository.port';
import type { Session } from '../../../domain/sessions/session.entity';

/**
 * A sessão como a LISTAGEM a devolve: a entidade mais o marcador `technical`
 * (RN-592). O marcador NÃO mora na entidade de propósito — ele não é coluna de
 * `sessions`, é o vínculo em `repo_bootstraps.session_id`, e só a listagem
 * precisa dele (é ela que a tela ordena para achar "a sessão mais recente").
 */
export type SessaoListada = Session & {
  technical: boolean;
  /** Uso da sessão (RN-1151): zeros e lista vazia quando nunca gastou. */
  costMicros: number;
  chamadas: number;
  agentes: string[];
  passos: number;
};

@Injectable()
export class ListSessionsForProjectUseCase {
  constructor(
    private readonly sessions: SessionRepository,
    private readonly repoBootstraps: RepoBootstrapRepository,
  ) {}

  /**
   * `technical` é `true` só para a sessão que o provisionamento abriu — a de
   * `repo_bootstraps.session_id` (uma por projeto, `unique(project_id)`). É o
   * MESMO critério do resumo do workspace
   * (`DrizzleProjectsSummaryRepository`, AT-131), e é por isso que o cliente
   * deixou de identificá-la pelo NOME (`git-bootstrap`): o nome é rótulo que o
   * usuário renomeia (RN-098), e renomear fazia a tela e a api discordarem de
   * qual é a sessão de trabalho (AT-183).
   */
  async execute(projectId: string): Promise<SessaoListada[]> {
    const [lista, bootstrap, uso] = await Promise.all([
      this.sessions.listForProject(projectId),
      this.repoBootstraps.findByProjectId(projectId),
      this.sessions.usoPorSessaoDoProjeto(projectId),
    ]);
    const tecnica = bootstrap?.sessionId ?? null;
    return lista.map((s) => ({
      ...s,
      technical: s.id === tecnica,
      costMicros: uso.get(s.id)?.costMicros ?? 0,
      chamadas: uso.get(s.id)?.chamadas ?? 0,
      agentes: uso.get(s.id)?.agentes ?? [],
      passos: uso.get(s.id)?.passos ?? 0,
    }));
  }
}
