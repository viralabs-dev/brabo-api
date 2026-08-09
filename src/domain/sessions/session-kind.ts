// O TIPO da sessão (FASE 20, RN-097).
//
// Puro e sem framework, pelo mesmo motivo da máquina de estados ao lado: a
// regra que decide se uma sessão pode executar precisa ser testável sem banco
// e sem TestingModule.
//
// ## Por que existe uma coluna, se o produto já sabia distinguir
//
// Sabia sobre UMA das duas perguntas. `findActiveExecutionSession` responde
// "esta sessão está executando?" procurando o evento `execution.activated` —
// isso é ESTADO, e continua sendo. O que não existia era a INTENÇÃO: no
// momento de abrir a sessão, o usuário não tinha como dizer se ela é só uma
// consulta ou se é para produzir. Sem essa declaração, toda sessão nascia
// idêntica e o único caminho para o Criativo era um botão na barra de topo —
// que é justamente o que ficou obscuro no uso real.
//
// ## A regra que impede as duas fontes de brigarem
//
// `kind` classifica a INTENÇÃO de criação e nunca muda. O evento continua
// classificando o ESTADO de execução. Nenhum reescreve o outro:
//
// - a derivação por evento NÃO passa a olhar `kind` (uma sessão `criativa` que
//   nunca ativou execução não é sessão de execução);
// - `execution.activated` numa sessão `consultiva` é ERRO, não conversão
//   silenciosa. Deixar o evento promover o tipo seria exatamente ter duas
//   fontes escrevendo uma sobre a outra.

export const SESSION_KINDS = ['consultiva', 'criativa'] as const;

export type SessionKind = (typeof SESSION_KINDS)[number];

/**
 * O tipo com que uma sessão nasce quando ninguém declara.
 *
 * É o que pode MENOS, de propósito: uma sessão que chega sem intenção
 * declarada não ganha o direito de executar. O DEFAULT da coluna é este
 * mesmo valor, e a api exige o campo no corpo — o default é rede de
 * segurança para caminho que não passa pela rota, não conveniência.
 */
export const SESSION_KIND_PADRAO: SessionKind = 'consultiva';

/**
 * O evento que marca o ESTADO de execução. Vive aqui — e não no caso de uso —
 * porque é o mesmo literal que a regra do tipo precisa reconhecer, e duas
 * cópias divergem.
 */
export const EVENTO_DE_EXECUCAO = 'execution.activated';

/** Só a sessão criada COM a intenção de produzir pode entrar em execução. */
export function podeAtivarExecucao(kind: SessionKind): boolean {
  return kind === 'criativa';
}

export class SessionKindNaoExecutaError extends Error {
  readonly kind: SessionKind;

  constructor(kind: SessionKind) {
    super(
      `Sessão do tipo "${kind}" não entra em execução: ` +
        `"${EVENTO_DE_EXECUCAO}" só é aceito em sessão "criativa". ` +
        `Abra uma sessão criativa — o tipo é escolhido na criação e não muda.`,
    );
    this.name = 'SessionKindNaoExecutaError';
    this.kind = kind;
  }
}

/** Lança quando o tipo não autoriza execução. Chamado antes de gravar. */
export function garantirQuePodeAtivarExecucao(kind: SessionKind): void {
  if (!podeAtivarExecucao(kind)) throw new SessionKindNaoExecutaError(kind);
}
