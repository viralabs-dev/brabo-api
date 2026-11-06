/**
 * Depois do merge da PR de infra que declara `run.app`, a api propõe o
 * `container_recreate` com a porta do app (AT-758, RN-1029). Puro, sem IO.
 */
import type { ContainerLifecycleStatus } from './container-lifecycle';

export const PRIMEIRA_PORTA_DO_APP = 13000;

export interface ContextoDeRecriacao {
  executionMode: string;
  container: { status: ContainerLifecycleStatus; statusChangedAt: Date } | null;
  recreatePendente: boolean;
  /** Quando o `run_instructions` vigente foi declarado. */
  declaradoEm: Date;
}

/** `null` = propõe; senão, o motivo de NÃO propor. */
export function motivoDeNaoRecriar(ctx: ContextoDeRecriacao): string | null {
  if (ctx.executionMode === 'runner') return 'projeto_runner';
  const c = ctx.container;
  if (
    !c ||
    c.status === 'removed' ||
    c.status === 'failed' ||
    c.status === 'provisioning'
  ) {
    return 'sem_container_de_pe';
  }
  if (ctx.recreatePendente) return 'recreate_pendente';
  // Subiu depois das instruções vigentes: já nasceu com o app.
  if (c.statusChangedAt.getTime() > ctx.declaradoEm.getTime()) {
    return 'container_ja_com_o_app';
  }
  return null;
}

/** Primeira porta livre a partir de 13000, pulando as já declaradas. */
export function proximaPortaLivre(ocupadas: Iterable<number>): number {
  const usadas = new Set(ocupadas);
  let porta = PRIMEIRA_PORTA_DO_APP;
  while (usadas.has(porta)) porta++;
  return porta;
}
