import { Injectable } from '@nestjs/common';
import {
  AnamneseOptOutRepository,
  ProficiencyProfileRepository,
} from '../../ports/proficiency-profile-repository.port';
import type { ProficiencyProfile } from '../../../domain/anamnese/proficiency-profile.entity';

@Injectable()
export class ListProficiencyProfilesUseCase {
  constructor(private readonly profiles: ProficiencyProfileRepository) {}

  execute(projectId: string): Promise<ProficiencyProfile[]> {
    return this.profiles.listByProject(projectId);
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
    private readonly profiles: ProficiencyProfileRepository,
    private readonly optOuts: AnamneseOptOutRepository,
  ) {}

  async execute(projectId: string, userId: string) {
    const deleted = await this.profiles.deleteByUser(projectId, userId);
    await this.optOuts.optOut(projectId, userId);
    return { deleted, optedOut: true as const };
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
