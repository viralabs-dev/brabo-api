import { Injectable } from '@nestjs/common';
import { UnitOfWork } from '../../ports/unit-of-work.port';
import {
  AnamneseOptOutRepository,
  ProficiencyProfileRepository,
} from '../../ports/proficiency-profile-repository.port';
import { ProjectRepository } from '../../ports/project-repository.port';
import { ResolveEffectiveRoleUseCase } from '../iam/resolve-effective-role.use-case';
import type { ProficiencyProfileView } from '../../../domain/anamnese/proficiency-profile.entity';

// Quem enxerga o perfil dos OUTROS. Perfil de competência é dado sobre a
// pessoa, então o default é ela ver o dela; a leitura de time (útil pra
// alocar trabalho) fica com quem administra o projeto.
const ROLES_QUE_VEEM_O_TIME = ['owner', 'maintainer'];

@Injectable()
export class ListProficiencyProfilesUseCase {
  constructor(
    private readonly profiles: ProficiencyProfileRepository,
    private readonly projects: ProjectRepository,
    private readonly resolveEffectiveRole: ResolveEffectiveRoleUseCase,
  ) {}

  async execute(
    projectId: string,
    requestedBy: string,
  ): Promise<ProficiencyProfileView[]> {
    const role = await this.resolveEffectiveRole.forProject(
      requestedBy,
      projectId,
    );

    const [rows, members] = await Promise.all([
      role !== null && ROLES_QUE_VEEM_O_TIME.includes(role)
        ? this.profiles.listByProject(projectId)
        : this.profiles.listByUser(projectId, requestedBy),
      this.projects.listMembers(projectId),
    ]);

    // `listMembers` já traz name/email — não precisa de consulta nova.
    const porUsuario = new Map(members.map((m) => [m.userId, m]));

    return rows.map((profile) => {
      const membro = porUsuario.get(profile.userId);
      return {
        ...profile,
        userName: membro?.name ?? null,
        userEmail: membro?.email ?? null,
      };
    });
  }
}

/**
 * "Todo o perfil visível e APAGÁVEL pelo usuário" (CLAUDE.md 4b.9).
 *
 * Apagar apaga de verdade (DELETE) **e** grava o opt-out: sem o opt-out
 * a rodada seguinte da Anamnese re-derivaria exatamente o mesmo perfil e
 * o botão seria cosmético. O usuário volta a ser perfilado só se pedir
 * (opt-in explícito).
 */
@Injectable()
export class DeleteProficiencyProfileUseCase {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly profiles: ProficiencyProfileRepository,
    private readonly optOuts: AnamneseOptOutRepository,
  ) {}

  async execute(projectId: string, userId: string) {
    // Os dois numa transação: um crash entre eles deixava o perfil apagado e
    // re-derivável, ou seja o apagar teria sido cosmético do mesmo jeito.
    return this.unitOfWork.runInTransaction(async () => {
      const deleted = await this.profiles.deleteByUser(projectId, userId);
      await this.optOuts.optOut(projectId, userId);
      return { deleted, optedOut: true as const };
    });
  }
}

@Injectable()
export class SetAnamneseOptInUseCase {
  constructor(private readonly optOuts: AnamneseOptOutRepository) {}

  async execute(projectId: string, userId: string) {
    await this.optOuts.optIn(projectId, userId);
    return { optedOut: false as const };
  }
}
