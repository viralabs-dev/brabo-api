import type { ProficiencyProfile } from '../../domain/anamnese/proficiency-profile.entity';
import type { ProficiencyLevel } from '../../domain/anamnese/proficiency-validation';

export interface UpsertProficiencyProfile {
  projectId: string;
  userId: string;
  competency: string;
  level: ProficiencyLevel;
  rationale: string;
  evidenceEventIds: string[];
}

export abstract class ProficiencyProfileRepository {
  // Idempotente por (projectId, userId, competency) — cada rodada da
  // Anamnese REVISA o nível em vez de acumular linhas.
  abstract upsertMany(
    inputs: UpsertProficiencyProfile[],
  ): Promise<ProficiencyProfile[]>;
  abstract listByProject(projectId: string): Promise<ProficiencyProfile[]>;
  abstract listByUser(
    projectId: string,
    userId: string,
  ): Promise<ProficiencyProfile[]>;
  // Apagar apaga DE VERDADE (o opt-out é que impede a re-derivação).
  abstract deleteByUser(projectId: string, userId: string): Promise<number>;
}

export abstract class AnamneseOptOutRepository {
  abstract optOut(projectId: string, userId: string): Promise<void>;
  abstract optIn(projectId: string, userId: string): Promise<void>;
  abstract listOptedOutUserIds(projectId: string): Promise<string[]>;
}
