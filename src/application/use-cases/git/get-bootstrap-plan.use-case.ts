import { Injectable } from '@nestjs/common';
import { RepoBootstrapRepository } from '../../ports/repo-bootstrap-repository.port';
import type {
  BootstrapPlan,
  BootstrapPlanDecision,
} from '../../../domain/git/repo-bootstrap.entity';

export interface BootstrapPlanEstado {
  plan: BootstrapPlan | null;
  decision: BootstrapPlanDecision | null;
  decidedAt: Date | null;
  decidedBy: string | null;
}

/**
 * O plano de adoção e o que foi decidido sobre ele (Fase 12a).
 *
 * Rota própria em vez de campo do status de bootstrap: o plano é grande
 * (dezenas de passos e diagnósticos) e só interessa a UMA tela, enquanto
 * `GET .../git/bootstrap` é consultado em polling de 1s pela tela de
 * progresso.
 */
@Injectable()
export class GetBootstrapPlanUseCase {
  constructor(private readonly repoBootstraps: RepoBootstrapRepository) {}

  async execute(projectId: string): Promise<BootstrapPlanEstado> {
    const row = await this.repoBootstraps.findByProjectId(projectId);
    return {
      plan: row?.plan ?? null,
      decision: row?.planDecision ?? null,
      decidedAt: row?.planDecidedAt ?? null,
      decidedBy: row?.planDecidedBy ?? null,
    };
  }
}
