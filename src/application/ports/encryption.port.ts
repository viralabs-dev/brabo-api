export interface EncryptedSecret {
  /**
   * Impressão digital da chave mestra que embrulhou o DEK (ADR 0158, RN-563).
   *
   * OPCIONAL e ANULÁVEL de propósito: `null`/ausente é a linha gravada antes
   * desta coluna existir, e significa "chave desconhecida", nunca "chave
   * atual". Nada no caminho de LEITURA decide por ele — `decrypt` continua
   * escolhendo a chave pela tentativa, com o GCM autenticando. Ele existe
   * para a consulta de progresso da rotação e para o diagnóstico.
   */
  keyId?: string | null;
  wrappedDek: string;
  dekIv: string;
  dekAuthTag: string;
  encryptedApiKey: string;
  apiKeyIv: string;
  apiKeyAuthTag: string;
}

export abstract class EncryptionService {
  abstract encrypt(plaintext: string): EncryptedSecret;
  abstract decrypt(secret: EncryptedSecret): string;
}
