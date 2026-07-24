import type { ProficiencyLevel } from './proficiency-validation';

export interface ProficiencyProfile {
  id: string;
  projectId: string;
  userId: string;
  competency: string;
  level: ProficiencyLevel;
  // "os porquês" — raciocínio + event ids que sustentam o nível.
  rationale: string;
  evidenceEventIds: string[];
  createdAt: Date;
  updatedAt: Date;
}
