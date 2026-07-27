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

/**
 * Perfil + a identidade humana de quem ele descreve.
 *
 * A tela mostrava o `userId` cru (um UUID) como cabeçalho do grupo, enquanto
 * todo o resto do app identifica pessoa por e-mail — é o perfil DA PESSOA, e
 * ela não se reconhece num UUID. `userEmail` é null quando quem tem perfil já
 * não é membro do projeto (o perfil sobrevive à remoção do membro); aí a UI
 * cai no id, que é melhor que nada.
 */
export interface ProficiencyProfileView extends ProficiencyProfile {
  userName: string | null;
  userEmail: string | null;
}
