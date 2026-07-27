import { Injectable } from '@nestjs/common';
import { ModuleMapRepository } from '../../ports/module-map-repository.port';
import { ProposedActionRepository } from '../../ports/proposed-action-repository.port';
import type { ModuleMap } from '../../../domain/architecture/module-map.entity';

export interface InfraContextAdr {
  title: string;
  content: string;
}

export interface InfraContext {
  moduleMap: ModuleMap | null;
  adrs: InfraContextAdr[];
}

/**
 * Contexto inicial do InfraAgent (Fase 4a): o module_map vigente (mesmo
 * `findCurrent` de GetArchitectureUseCase) + os ADRs marcados
 * `infraRelevant: true` pelo Arquiteto (payload opcional de `open_adr_pr`,
 * mesmo padrão de passthrough que `securityRelevant` — default `false`,
 * lido defensivamente, nunca enforced no schema do tool). Mirror de
 * GetDevTaskContextUseCase, sem task/story (o InfraAgent não trabalha em
 * cima de uma).
 */
@Injectable()
export class GetInfraContextUseCase {
  constructor(
    private readonly moduleMaps: ModuleMapRepository,
    private readonly proposedActions: ProposedActionRepository,
  ) {}

  async execute(projectId: string): Promise<InfraContext> {
    const [moduleMap, adrActions] = await Promise.all([
      this.moduleMaps.findCurrent(projectId),
      this.proposedActions.listByProjectAndType(projectId, 'open_adr_pr'),
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

    return { moduleMap, adrs };
  }
}
