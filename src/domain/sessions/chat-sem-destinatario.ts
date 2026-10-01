import type { SessionKind } from './session-kind';

/**
 * A mensagem SEM destinatário numa sessão consultiva sem agente (RN-682,
 * AT-254). A rota de chat da sessão (`POST .../chat`) não carrega agente: ela
 * manda o texto ao modelo vinculado CRU — sem histórico, sem prompt de
 * sistema, sem ferramenta —, e a resposta sai assinada pelo nome do modelo.
 * Medido no uso real de 29/09: "não tenho acesso a conversas anteriores".
 *
 * A decisão do dono (01/10) é que a consultiva sem agente PEDE um agente. A
 * tela trava o envio; esta regra é a mesma recusa do lado da api, para que um
 * cliente que não seja a tela não a fure — o molde da RN-584 (nenhum
 * destinatário padrão, e o que não tem destinatário é recusa NOMEADA).
 *
 * Puro: recebe o tipo da sessão e se algum agente já foi ativado nela.
 */
export const MOTIVO_CHAT_SEM_DESTINATARIO = 'destinatario_ausente';

export const MENSAGEM_CHAT_SEM_DESTINATARIO =
  'Esta sessão consultiva não tem agente: escolha um agente e mande a ' +
  'mensagem a ele (POST .../agents/:agent/message). Nada foi gravado e ' +
  'nenhum modelo foi chamado.';

export function chatSemDestinatarioRecusado(
  kind: SessionKind,
  algumAgenteAtivado: boolean,
): boolean {
  return kind === 'consultiva' && !algumAgenteAtivado;
}
