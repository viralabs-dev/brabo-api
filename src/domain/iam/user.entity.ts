export interface User {
  id: string;
  /**
   * `null` para usuário criado pelo auth first-party (Fase 7a), que não passa
   * pelo Keycloak. Enquanto os dois emissores convivem, o campo distingue a
   * origem da conta; na 7.2, quando o Keycloak sair, ele sai junto.
   */
  keycloakSub: string | null;
  email: string;
  name: string | null;
  createdAt: Date;
  updatedAt: Date;
}
