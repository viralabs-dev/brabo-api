export interface Workspace {
  id: string;
  name: string;
  slug: string;
  createdBy: string;
  /** Quem escolhe a ferramenta do passo (ADR 0179, ADR 0290): `jev` (padrão), `laya` ou `desligado`. */
  toolRouter: 'jev' | 'laya' | 'desligado';
  /** Derivada: `toolRouter !== 'desligado'`. */
  toolRouterEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}
