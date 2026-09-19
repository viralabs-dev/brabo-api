// A execução não começa sem repositório (RN-582, ADR 0165).
//
// Puro e sem IO, como `agent-activation.ts`: recebe os handoffs do projeto JÁ
// carregados e decide QUAL frase a recusa diz. Quem decide SE recusa é o caso
// de uso (`ActivateExecutionUseCase`), que é quem consulta o repositório.
//
// A frase existe porque o 409 sozinho não ensina nada: o repositório nasce
// por um gesto que o usuário faz em OUTRA tela (aceitar um handoff), e a
// recusa tem de dizer qual — ou, quando não há gesto pendente, onde
// provisionar à mão.

import type { HandoffView } from '../sessions/agent-activation';

/** O agente cujo aceite de handoff é o GATILHO do provisionamento. */
export const AGENTE_GATILHO_DO_REPOSITORIO = 'arquiteto';
/** O agente cujo aceite é a SEGUNDA PORTA, idempotente. */
export const AGENTE_SEGUNDA_PORTA_DO_REPOSITORIO = 'dev-lead';

const PREFIXO =
  'Projeto sem repositório — a execução não pode começar, porque os dev ' +
  'agents trabalham em worktrees dele (RN-582).';

/**
 * O motivo NOMEADO da recusa de `execution/activate` sem repositório, na ordem
 * em que o usuário consegue agir:
 *
 * 1. handoff ao Arquiteto `offered` → aceitá-lo provisiona (o gatilho);
 * 2. handoff ao Dev Lead `offered` → aceitá-lo provisiona (a segunda porta —
 *    é a saída do projeto que passou pelo Arquiteto antes da RN-582);
 * 3. algum dos dois já `accepted` → o provisionamento automático rodou e não
 *    deixou repositório; o `repository.provision_failed` diz por quê, e o
 *    caminho é a página de provisionamento;
 * 4. nenhum → nenhum handoff ao Arquiteto foi aceito ainda.
 *
 * `projectId` entra só para nomear a rota da página de provisionamento.
 */
export function motivoDeExecucaoSemRepositorio(
  projectId: string,
  handoffs: readonly HandoffView[],
): string {
  const tem = (agente: string, status: HandoffView['status']) =>
    handoffs.some((h) => h.toAgent === agente && h.status === status);
  const paginaDeProvisionamento = `/projects/${projectId}/provisioning?provider=local`;

  if (tem(AGENTE_GATILHO_DO_REPOSITORIO, 'offered')) {
    return (
      `${PREFIXO} Aceite o handoff ao Arquiteto, que está oferecido: é no ` +
      'aceite dele que o repositório nasce.'
    );
  }
  if (tem(AGENTE_SEGUNDA_PORTA_DO_REPOSITORIO, 'offered')) {
    return (
      `${PREFIXO} Aceite o handoff ao Dev Lead, que está oferecido: o aceite ` +
      'provisiona o repositório que falta.'
    );
  }
  if (
    tem(AGENTE_GATILHO_DO_REPOSITORIO, 'accepted') ||
    tem(AGENTE_SEGUNDA_PORTA_DO_REPOSITORIO, 'accepted')
  ) {
    return (
      `${PREFIXO} O handoff que o provisiona já foi aceito e não deixou ` +
      'repositório — o evento `repository.provision_failed` da sessão diz por ' +
      `quê. Provisione pela página de provisionamento (${paginaDeProvisionamento}).`
    );
  }
  return (
    `${PREFIXO} Nenhum handoff ao Arquiteto foi aceito ainda, e é no aceite ` +
    'dele que o repositório nasce. Para provisionar sem esperar, use a página ' +
    `de provisionamento (${paginaDeProvisionamento}).`
  );
}
