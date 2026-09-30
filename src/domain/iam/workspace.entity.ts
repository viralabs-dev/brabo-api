export interface Workspace {
  id: string;
  name: string;
  slug: string;
  createdBy: string;
  /** Roteamento de ferramenta pelo Jev (ADR 0179); vale só com provider OpenRouter. */
  toolRouterEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}
