import { BOOTSTRAP_STEPS, type RepoBootstrap } from './repo-bootstrap.entity';

const LAST_STEP = BOOTSTRAP_STEPS[BOOTSTRAP_STEPS.length - 1];

export type ProvisioningStatus =
  | 'provisioning'
  | 'provisioned'
  | 'provision_failed'
  /**
   * Repositório adotado com plano gerado e ainda NÃO decidido (Fase 12a).
   * Não é "provisionando": nada está acontecendo, e nada vai acontecer
   * até alguém aprovar o plano ou adotar como está. Sem este estado o
   * projeto ficaria em `provisioning` para sempre, com o Dashboard
   * fazendo poll de um trabalho que não existe.
   */
  | 'awaiting_plan_decision';

/**
 * Puro, sem IO — deriva o status de provisionamento do PROJETO a partir
 * do cursor de bootstrap, em vez de persistir um status redundante (ver
 * mesma filosofia de domain/actions/action-state-machine.ts).
 *
 * Na adoção quem manda é a DECISÃO, não o cursor: `as_is` significa
 * bootstrap dispensado por escolha do usuário, e o cursor fica onde
 * está — nenhum passo rodou, e mentir que rodou seria transformar o
 * seed manual da Fase 10 em comportamento oficial. O que torna o projeto
 * operável é a decisão registrada, não um cursor adulterado.
 */
export function deriveProvisioningStatus(
  row: RepoBootstrap | null,
  /**
   * O motivo pelo qual a CRIAÇÃO do repositório falhou, quando falhou.
   *
   * Existe porque há um fracasso que acontece ANTES de a linha de bootstrap
   * nascer: `ProvisionRepositoryUseCase` só cria o cursor depois de o provider
   * confirmar o repositório, então uma recusa em `createRepo` deixava o projeto
   * com ZERO linha — e "sem linha" era indistinguível de "nunca começou".
   * O endpoint devolvia `{status: null, lastError: null}`, a tela mostrava
   * "Iniciando provisionamento…" e pollava para sempre, sem botão de saída.
   *
   * Não vira uma linha de bootstrap `failed` porque isso exigiria escolher um
   * `step`, e nenhum dos seis descreve o que aconteceu: o repositório não
   * existe, então nenhum passo do Gitflow chegou a ser tentado. Mentir o passo
   * para ganhar um estado seria trocar um silêncio por uma informação errada.
   */
  falhaDeCriacao?: string | null,
): ProvisioningStatus | null {
  if (!row) return falhaDeCriacao ? 'provision_failed' : null;
  if (row.status === 'failed') return 'provision_failed';
  if (row.planDecision === 'as_is') return 'provisioned';
  if (row.plan !== null && row.planDecision === null) {
    return 'awaiting_plan_decision';
  }
  if (row.step === LAST_STEP && row.status === 'done') {
    return 'provisioned';
  }
  return 'provisioning';
}
