import { Injectable } from '@nestjs/common';
import type { GitProviderName } from '@brabo/shared';
import { ModuleMapRepository } from '../../ports/module-map-repository.port';
import { ProposedActionRepository } from '../../ports/proposed-action-repository.port';
import { ProvisionedRepositoryRepository } from '../../ports/provisioned-repository-repository.port';
import type { ModuleMap } from '../../../domain/architecture/module-map.entity';

export interface InfraContextAdr {
  title: string;
  content: string;
}

export interface InfraContext {
  moduleMap: ModuleMap | null;
  adrs: InfraContextAdr[];
  // Fase 8c: o subagente Workflows decide o FORMATO do pipeline de CI por
  // isto — 'gitlab' gera `.gitlab-ci.yml`, qualquer outro valor (incl.
  // `null`, projeto ainda sem repositório provisionado) gera GitHub
  // Actions. Não é `capabilities` do GitProvider — GitHub e GitLab têm as
  // MESMAS capabilities (`{protectBranch: true, pullRequests: true}`); só
  // `provider.name` distingue.
  gitProvider: GitProviderName | null;
}

/**
 * Contexto inicial da área de Infra (Fase 4a; `gitProvider` — Fase 8c): o
 * module_map vigente (mesmo `findCurrent` de GetArchitectureUseCase) + os
 * ADRs marcados `infraRelevant: true` pelo Arquiteto (payload opcional de
 * `open_adr_pr`, mesmo padrão de passthrough que `securityRelevant` —
 * default `false`, lido defensivamente, nunca enforced no schema do tool) +
 * o provider do repositório provisionado do projeto. Mirror de
 * GetDevTaskContextUseCase, sem task/story (a área de Infra não trabalha em
 * cima de uma).
 */
@Injectable()
export class GetInfraContextUseCase {
  constructor(
    private readonly moduleMaps: ModuleMapRepository,
    private readonly proposedActions: ProposedActionRepository,
    private readonly provisionedRepositories: ProvisionedRepositoryRepository,
  ) {}

  async execute(projectId: string): Promise<InfraContext> {
    const [moduleMap, adrActions, repo] = await Promise.all([
      this.moduleMaps.findCurrent(projectId),
      this.proposedActions.listByProjectAndType(projectId, 'open_adr_pr'),
      this.provisionedRepositories.findByProjectId(projectId),
    ]);

    const adrs: InfraContextAdr[] = adrActions
      .map((a) => {
        const payload = a.payload as {
          title?: string;
          content?: string;
          infraRelevant?: boolean;
        };
        return {
          title: payload.title ?? '(ADR sem título)',
          content: payload.content ?? '',
          infraRelevant: payload.infraRelevant ?? false,
        };
      })
      .filter((a) => a.infraRelevant)
      .map(({ title, content }) => ({ title, content }));

    return { moduleMap, adrs, gitProvider: repo?.provider ?? null };
  }
}
