/**
 * Escada do lockout progressivo (Fase 7a, item 2).
 *
 * Puro: recebe quantas falhas houve na janela e devolve por quanto tempo
 * bloquear. Sem banco, sem relógio, sem I/O — a parte que decide é testável
 * isoladamente, e a parte que consulta o Postgres fica no repositório.
 */

export interface DegrauDaEscada {
  /** A partir de quantas falhas na janela este degrau vale. */
  falhas: number;
  /** Por quantos segundos bloquear. */
  segundos: number;
}

export interface ConfiguracaoDeLockout {
  janelaMs: number;
  escada: DegrauDaEscada[];
}

/**
 * Escada padrão: 5 falhas → 30s, 8 → 5min, 12 → 15min.
 *
 * O teto (15 min) é IGUAL à janela, e isso não é coincidência: com janela
 * deslizante, quem continua tentando empurra a janela junto e fica bloqueado
 * enquanto insistir, enquanto quem parou 15 minutos volta com a janela limpa.
 * Teto MAIOR que a janela criaria um bloqueio que a janela não consegue
 * representar, e exigiria uma coluna `locked_until` persistente — com fila de
 * destrava, endpoint de admin e tudo que vem junto. Não mexa em um sem o
 * outro.
 */
export const ESCADA_PADRAO: DegrauDaEscada[] = [
  { falhas: 5, segundos: 30 },
  { falhas: 8, segundos: 300 },
  { falhas: 12, segundos: 900 },
];

export class EscadaInvalidaError extends Error {}

/**
 * Lê a escada de `AUTH_LOCKOUT_THRESHOLDS`, no formato `falhas:segundos`
 * separado por vírgula. Ex.: `5:30,8:300,12:900`.
 *
 * Valida em vez de aceitar o que vier: escada fora de ordem ou com número
 * inválido não é configuração exótica, é lockout que não bloqueia — e o
 * sintoma seria silêncio absoluto até alguém ser atacado.
 */
export function lerEscada(bruto: string | undefined): DegrauDaEscada[] {
  if (!bruto?.trim()) return ESCADA_PADRAO;

  const degraus = bruto.split(',').map((par) => {
    const [falhas, segundos] = par.split(':').map((n) => Number(n.trim()));
    if (!Number.isInteger(falhas) || falhas < 1) {
      throw new EscadaInvalidaError(
        `AUTH_LOCKOUT_THRESHOLDS: "${par}" não tem um número de falhas válido`,
      );
    }
    if (!Number.isInteger(segundos) || segundos < 1) {
      throw new EscadaInvalidaError(
        `AUTH_LOCKOUT_THRESHOLDS: "${par}" não tem uma duração válida`,
      );
    }
    return { falhas, segundos };
  });

  for (let i = 1; i < degraus.length; i++) {
    if (degraus[i].falhas <= degraus[i - 1].falhas) {
      throw new EscadaInvalidaError(
        'AUTH_LOCKOUT_THRESHOLDS: os degraus precisam estar em ordem crescente de falhas',
      );
    }
    if (degraus[i].segundos < degraus[i - 1].segundos) {
      throw new EscadaInvalidaError(
        'AUTH_LOCKOUT_THRESHOLDS: a duração não pode diminuir conforme as falhas aumentam',
      );
    }
  }
  return degraus;
}

/**
 * Duração do bloqueio para um número de falhas — 0 quando ainda não bloqueia.
 *
 * Vale o MAIOR degrau alcançado, não o primeiro: com 5:30 e 8:300, dez falhas
 * dão 300s. Parar no primeiro degrau que casa faria a escada não escalar.
 */
export function segundosDeBloqueio(
  falhas: number,
  escada: DegrauDaEscada[] = ESCADA_PADRAO,
): number {
  let segundos = 0;
  for (const degrau of escada) {
    if (falhas >= degrau.falhas) segundos = degrau.segundos;
  }
  return segundos;
}

/**
 * Até quando o balde está bloqueado, dado o instante da última falha.
 *
 * `null` = liberado. O bloqueio conta a partir da ÚLTIMA falha, não da
 * primeira: contar da primeira faria o bloqueio expirar enquanto o atacante
 * ainda está tentando.
 */
export function bloqueadoAte(
  falhas: number,
  ultimaFalha: Date | null,
  escada: DegrauDaEscada[] = ESCADA_PADRAO,
): Date | null {
  if (!ultimaFalha) return null;
  const segundos = segundosDeBloqueio(falhas, escada);
  if (segundos === 0) return null;
  return new Date(ultimaFalha.getTime() + segundos * 1000);
}
