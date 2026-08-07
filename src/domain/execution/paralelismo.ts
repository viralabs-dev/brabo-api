/**
 * Quem decide quantos agentes sobem, e quando isso vira decisão do usuário
 * (ADR 0053, FASE 14d).
 *
 * O lead avalia quantos agentes valem a pena para o trabalho em mão — não é
 * mais um número no código. Mas a decisão dele não é soberana sobre GASTO:
 * acima do teto, vira `proposed_action` e o usuário decide.
 *
 * **O teto é da SESSÃO, não do módulo.** Contar por módulo permitiria N
 * módulos × 2 agentes sem autorização nenhuma — o buraco de hoje com outro
 * nome. É a única parte desta regra que não é óbvia, e a que um refactor
 * desatento desfaz.
 */
export type DecisaoDeParalelismo =
  | { permitido: true; requerAutorizacao: false }
  | { permitido: true; requerAutorizacao: true; excedente: number }
  | { permitido: false; motivo: string };

export interface EntradaDeParalelismo {
  /** Dev agents JÁ de pé na sessão, somando todos os módulos. */
  ativosNaSessao: number;
  /** Quantos o lead quer subir agora. */
  pedidos: number;
  /** O teto que o lead usa sem perguntar (`agent_areas.max_parallel`). */
  maxParallel: number;
}

export function decidirParalelismo({
  ativosNaSessao,
  pedidos,
  maxParallel,
}: EntradaDeParalelismo): DecisaoDeParalelismo {
  if (pedidos < 1) {
    return { permitido: false, motivo: 'pedido de zero agente não é pedido' };
  }

  // Teto NEGATIVO ou zero não é "sem limite": é configuração inválida, e
  // tratá-la como ilimitada transformaria um erro de digitação em gasto
  // irrestrito.
  if (maxParallel < 1) {
    return {
      permitido: false,
      motivo: `max_parallel inválido (${maxParallel}) — o mínimo é 1`,
    };
  }

  const total = ativosNaSessao + pedidos;

  if (total <= maxParallel) {
    return { permitido: true, requerAutorizacao: false };
  }

  return {
    permitido: true,
    requerAutorizacao: true,
    excedente: total - maxParallel,
  };
}

/**
 * O texto que o usuário lê ao decidir.
 *
 * Mora aqui, e não na tela, porque ele vai para o `payload` da
 * `proposed_action` — que é imutável e fica no event log. Quem ler daqui a
 * seis meses precisa entender o que foi autorizado sem reconstruir o estado.
 */
export function motivoDoPedido(entrada: EntradaDeParalelismo): string {
  const { ativosNaSessao, pedidos, maxParallel } = entrada;
  const total = ativosNaSessao + pedidos;

  return (
    `O lead quer ${pedidos} agente(s) a mais nesta sessão, que já tem ` +
    `${ativosNaSessao}. Isso levaria a ${total}, acima do teto de ` +
    `${maxParallel} que ele pode usar sem perguntar.`
  );
}
