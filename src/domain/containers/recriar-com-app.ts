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

export interface OcupacaoDePortas {
  /** Publicadas no host por container (do Brabo ou de terceiro), inclusive as do próprio projeto. */
  ocupadasNoHost: Iterable<number>;
  /** Declaradas na rede vigente de OUTROS projetos: um container removido volta a pedi-las no `start`. */
  declaradasPorOutros: Iterable<number>;
  /** Publicadas pelo container do próprio projeto: contam como livres, o recreate o remove antes. */
  doProprioProjeto: Iterable<number>;
}

/** ADR 0298: primeira porta livre a partir de 13000, olhando o host e as redes de outros projetos. */
export function portaLivreDoApp(o: OcupacaoDePortas): number {
  const proprias = new Set(o.doProprioProjeto);
  const usadas = new Set(o.declaradasPorOutros);
  for (const p of o.ocupadasNoHost) if (!proprias.has(p)) usadas.add(p);
  let porta = PRIMEIRA_PORTA_DO_APP;
  while (usadas.has(porta)) porta++;
  return porta;
}
