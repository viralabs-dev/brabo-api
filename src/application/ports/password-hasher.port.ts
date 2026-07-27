export interface ParametrosArgon2 {
  memoryCost: number;
  timeCost: number;
  parallelism: number;
}

/**
 * Porta de hash de senha — implementada por `Argon2PasswordHasher`.
 *
 * `dummyHash` faz parte do CONTRATO, e não é detalhe da implementação: o
 * caso de uso de login precisa de um hash válido para verificar quando o
 * usuário não existe, senão o ramo de e-mail inexistente responde em
 * microssegundos e o tempo denuncia o que o corpo uniforme esconde.
 *
 * `params` é exposto para o teste conseguir afirmar que o dummy foi gerado com
 * OS MESMOS parâmetros do hash real — um dummy mais barato inverte o oráculo
 * em vez de fechá-lo, e é a forma mais comum de errar esta mitigação.
 */
export abstract class PasswordHasher {
  abstract hash(plaintext: string): Promise<string>;
  abstract verify(encoded: string, plaintext: string): Promise<boolean>;
  abstract readonly dummyHash: string;
  abstract readonly params: ParametrosArgon2;
}
