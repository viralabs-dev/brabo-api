export interface EstadoDoBalde {
  /** Falhas na janela, JÁ incluindo a tentativa que acabou de ser registrada. */
  falhas: number;
  /**
   * Até quando o balde estava bloqueado ANTES desta tentativa. `null` =
   * liberado, e a tentativa deve prosseguir.
   *
   * O recorte é no estado ANTERIOR de propósito. Se fosse no posterior, com
   * limiar 5 a quinta tentativa seria recusada mesmo com a senha certa — quem
   * errasse quatro vezes não conseguiria mais entrar até a janela drenar, e o
   * limiar valeria na prática 4. O usuário legítimo pagaria por um limite que
   * o sistema diz ser 5.
   */
  bloqueadoAte: Date | null;
  /** `false` quando o hit não foi registrado por o balde já estar bloqueado. */
  registrou: boolean;
}

/**
 * Janela deslizante do lockout, no Postgres (Fase 7a, item 2) — sem Redis,
 * como o resto do sistema.
 *
 * Não é um guard. `RateLimitGuard` e qualquer guard rodam ANTES da verificação
 * da senha e por isso não sabem se ela estava certa — e é exatamente essa
 * distinção que o lockout precisa fazer. Daí ser porta, chamada de dentro do
 * caso de uso.
 */
export abstract class LoginThrottle {
  /**
   * Registra a tentativa e devolve o estado do balde.
   *
   * O registro é CONDICIONAL: enquanto o balde está bloqueado nada é gravado.
   * Sem isso, um cliente que repete em laço prorroga o próprio bloqueio para
   * sempre — e, pior, um atacante mantém a conta da VÍTIMA travada
   * indefinidamente só continuando a tentar. Lockout viraria negação de
   * serviço contra quem ele deveria proteger.
   */
  abstract registrarEContar(bucketKey: string): Promise<EstadoDoBalde>;

  /** Só consulta, sem registrar. */
  abstract consultar(bucketKey: string): Promise<EstadoDoBalde>;

  /**
   * Limpa o balde — chamado no login bem-sucedido.
   *
   * Legítimo porque `auth_lockout_hits` é contador efêmero, não trilha: a
   * auditoria fica em `auth_events`, que ninguém apaga. Foi para poder fazer
   * isto sem violar o append-only que as duas tabelas são separadas.
   *
   * Vale SÓ para o balde do e-mail. Limpar o balde de IP no sucesso deixaria
   * quem tem uma conta válida zerar a janela à vontade: logar, pulverizar
   * dezenove palpites em outras contas, logar de novo, para sempre.
   */
  abstract limpar(bucketKey: string): Promise<void>;
}
