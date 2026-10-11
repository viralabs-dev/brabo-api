import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * AT-516 (RN-848): a escrita em curso é EFEITO de uma ação executada pela
 * própria api (a ação auto-aprovada que `ProposeActionUseCase` executa dentro
 * do pedido interno do engine)? O engine só avisa o canal do evento que ELE
 * pediu para gravar; o que a api grava por conta própria como efeito da ação
 * (`infra.pr_opened`, `adr.pr_opened`, `action.*`) nenhuma fachada avisa, e
 * o `HttpSessionChannelNotifier` consulta esta marca para avisar mesmo dentro
 * de `/internal/*`.
 */
const als = new AsyncLocalStorage<true>();

export function runComoEfeitoDeAcao<T>(work: () => T): T {
  return als.run(true, work);
}

export function ehEfeitoDeAcao(): boolean {
  return als.getStore() === true;
}
