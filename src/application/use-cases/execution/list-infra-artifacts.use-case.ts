import { Injectable } from '@nestjs/common';
import { InfraArtifactRepository } from '../../ports/infra-artifact-repository.port';
import { ProposedActionRepository } from '../../ports/proposed-action-repository.port';
import type { InfraArtifact } from '../../../domain/execution/infra-artifact.entity';

/**
 * Lista os artefatos de infra do projeto (Fase 4a) — alimenta a seção "PRs
 * de infra em revisão" da tab Aprovações, mesmo espírito de
 * GetArchitectureUseCase pras ADRs.
 *
 * RN-752 (AT-436): PR de infra MERGEADA sai da lista. O gate termina em
 * `awaiting_user` e nada mexia nele depois do merge, então a seção seguia
 * mostrando "Você" pendente sobre uma PR que já entrou. A régua é DERIVADA,
 * sem coluna nova: a PR do artefato é o `pullRequestId` do resultado do
 * `open_infra_pr` que a abriu, e ela está mergeada quando um `git_merge`
 * EXECUTADO do projeto devolveu `state: 'merged'` para esse id — o mesmo
 * casamento por `pullRequestId` que fecha as tarefas (RN-628).
 */
@Injectable()
export class ListInfraArtifactsUseCase {
  constructor(
    private readonly infraArtifacts: InfraArtifactRepository,
    private readonly proposedActions: ProposedActionRepository,
  ) {}

  async execute(projectId: string): Promise<InfraArtifact[]> {
    const artefatos = await this.infraArtifacts.listByProject(projectId);
    if (artefatos.length === 0) return artefatos;

    const [aberturas, merges] = await Promise.all([
      this.proposedActions.listByProjectAndType(projectId, 'open_infra_pr'),
      this.proposedActions.listByProjectAndType(projectId, 'git_merge'),
    ]);

    const prsMergeadas = new Set<string>();
    for (const m of merges) {
      const r = m.executionResult as
        { state?: unknown; pullRequestId?: unknown } | null | undefined;
      if (
        m.status === 'executed' &&
        r?.state === 'merged' &&
        typeof r.pullRequestId === 'string'
      ) {
        prsMergeadas.add(r.pullRequestId);
      }
    }
    if (prsMergeadas.size === 0) return artefatos;

    const prDaAbertura = new Map<string, string>();
    for (const a of aberturas) {
      const r = a.executionResult as
        { pullRequestId?: unknown } | null | undefined;
      if (typeof r?.pullRequestId === 'string' && r.pullRequestId !== '') {
        prDaAbertura.set(a.id, r.pullRequestId);
      }
    }

    return artefatos.filter((artefato) => {
      const pr = prDaAbertura.get(artefato.prActionId);
      return !(pr && prsMergeadas.has(pr));
    });
  }
}
