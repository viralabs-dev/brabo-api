/**
 * Período do teto de gasto (ADR 0296, RN-1168): o teto de projeto, de área e
 * de workspace conta o MÊS CIVIL EM UTC. Funções puras, sem I/O.
 */
const DIA_MS = 86_400_000;

/** 1º dia do mês UTC de `now`, como `YYYY-MM-DD`. */
export function inicioDoMes(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    .toISOString()
    .slice(0, 10);
}

/** O gasto gravado só vale no mês dele; vencido = 0 no mês corrente. */
export function gastoVigente(
  periodoInicio: string | null,
  spentMicros: number,
  now: Date,
): number {
  return periodoInicio === inicioDoMes(now) ? spentMicros : 0;
}

export interface PeriodoDoTeto {
  inicio: string;
  fim: string;
  diasRestantes: number;
  previsaoMicros: number;
}

/** Previsão linear: gasto × duração do mês ÷ decorrido (mínimo 1 dia). Derivada, nunca gravada. */
export function periodoDoTeto(spentMicros: number, now: Date): PeriodoDoTeto {
  const ini = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const fim = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
  const decorrido = Math.max(1, (now.getTime() - ini) / DIA_MS);
  return {
    inicio: new Date(ini).toISOString().slice(0, 10),
    fim: new Date(fim).toISOString().slice(0, 10),
    diasRestantes: Math.ceil((fim - now.getTime()) / DIA_MS),
    previsaoMicros: Math.round(
      (spentMicros * ((fim - ini) / DIA_MS)) / decorrido,
    ),
  };
}
