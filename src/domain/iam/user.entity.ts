/**
 * O idioma da interface (fundação de i18n, Onda 6a). Fechado a dois valores —
 * abrir para qualquer BCP-47 exigiria arquivo de recurso e fallback que a
 * extração de strings (etapa separada, em paralelo) ainda não tem.
 */
export type UserLocale = 'pt-BR' | 'en';

export const USER_LOCALES: readonly UserLocale[] = ['pt-BR', 'en'];

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
  /** Default 'pt-BR' — nunca flipar silenciosamente quem já tem conta. */
  locale: UserLocale;
  /**
   * O idioma em que os agentes respondem a esta pessoa (RN-618) — `null` é o
   * AUTOMÁTICO, e é assim que toda conta nasce. Código BCP-47 canônico.
   */
  responseLanguage: string | null;
  /**
   * O idioma detectado pelas mensagens e CONFIRMADO pela pessoa (RN-618) —
   * só existe confirmado, e os dois campos são nulos juntos.
   */
  detectedLanguage: string | null;
  detectedLanguageConfirmedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
