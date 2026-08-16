import type { RecursosDoContainer } from './project-container';

/**
 * O CICLO DE VIDA do container de um projeto (ADR 0081, fecha o corte
 * declarado pela FASE 25b / ADR 0065 "O que este ADR NÃO faz").
 *
 * ## Onde isto termina, com todas as letras
 *
 * Este módulo — e a tabela `project_containers` que ele valida — só GRAVA e
 * LÊ estado. Nenhuma linha daqui dispara `docker run`, `docker stop` ou
 * qualquer chamada a um daemon Docker: nenhum serviço do produto (api,
 * engine) monta `/var/run/docker.sock` nem roda `privileged`, e decidir
 * conceder isso é decisão de segurança que esta fatia NÃO toma. Um
 * orquestrador real — sidecar com privilégio restrito, ou outro desenho — é
 * quem vai CONSUMIR esta tabela no futuro, transicionando o estado dela à
 * medida que comanda o container de verdade. Até lá, `containerId` fica
 * `null` para sempre e cada transição é um pedido que alguém (hoje, um
 * humano ou um teste; amanhã, o orquestrador) registra depois de já ter
 * acontecido — nunca o gatilho de nada.
 *
 * ## Por que TABELA, e não evento (ao contrário de `project-container.ts`)
 *
 * `project-container.ts` guarda a DECISÃO do Arquiteto — imutável,
 * versionada, sem tabela, porque é o mesmo tipo de fato que `module_map` e
 * `business_rule`. Isto aqui é o oposto: ESTADO, que muda de valor no
 * MESMO recurso (o container só pode estar rodando OU parado, nunca as
 * duas versões simultâneas sendo igualmente "verdadeiras"). Event-sourcing
 * esse estado obrigaria projetar a cada leitura o que uma coluna já diz de
 * graça — a mesma razão que o ADR 0065 já registrou em "Alternativas
 * consideradas" ao adiar esta tabela para quando houvesse slot de
 * migration.
 *
 * ## O nome dos estados
 *
 * `provisioning` — pedido de subir aceito, esperando o (futuro)
 * orquestrador confirmar. `running` — container de pé. `stopped` —
 * parado, mas não descartado: pode voltar a `running` sem reprovisionar.
 * `failed` — a tentativa de provisionar ou de manter rodando não deu
 * certo; carrega `failureReason`. `removed` — descartado; a única saída
 * dele é provisionar de novo (uma imagem nova do Arquiteto, um teto de
 * recursos novo — nunca o mesmo container "voltando à vida").
 */
export const CONTAINER_LIFECYCLE_STATUSES = [
  'provisioning',
  'running',
  'stopped',
  'failed',
  'removed',
] as const;

export type ContainerLifecycleStatus =
  (typeof CONTAINER_LIFECYCLE_STATUSES)[number];

/**
 * O registro persistido — uma linha por PROJETO (não por container, não por
 * task): o `project_id` é único na tabela porque só existe UM container
 * vigente por projeto de cada vez, o mesmo desenho que `dev_agent_states`
 * usa para o agente (ADR 0045).
 */
export interface ProjectContainerLifecycle {
  id: string;
  projectId: string;
  status: ContainerLifecycleStatus;
  /**
   * A versão de `artifact.project_image` (ADR 0065) que esta linha
   * corresponde — um NÚMERO, não uma cópia da decisão. A decisão em si
   * continua vivendo só no event log; esta coluna aponta para ela e nunca
   * duplica `image`/`rationale`/`network`.
   */
  imageVersion: number;
  /** Id do container real, só quando/se um orquestrador existir. */
  containerId: string | null;
  /**
   * Teto de recursos DECLARADO no momento em que esta linha nasceu —
   * espelha `RecursosDoContainer` do artefato do Arquiteto vigente naquele
   * instante. Não é reaplicado a cada leitura porque um artefato revisado
   * depois de o container já ter subido não deve mudar retroativamente o
   * que uma instância já provisionada promete; reprovisionar é que lê o
   * artefato de novo.
   */
  resources: RecursosDoContainer;
  /** Só populado numa transição para `failed`. */
  failureReason: string | null;
  createdAt: Date;
  statusChangedAt: Date;
}

export class InvalidContainerTransitionError extends Error {
  readonly from: ContainerLifecycleStatus;
  readonly to: ContainerLifecycleStatus;

  constructor(from: ContainerLifecycleStatus, to: ContainerLifecycleStatus) {
    super(
      `Transição de ciclo de vida de container inválida: "${from}" -> "${to}"`,
    );
    this.name = 'InvalidContainerTransitionError';
    this.from = from;
    this.to = to;
  }
}

/**
 * `removed -> provisioning` é a única saída de `removed`: nunca terminal de
 * verdade, porque um projeto pode reprovisionar depois de limpar (imagem
 * nova, recursos novos). `provisioning -> removed` cobre cancelar um
 * provisionamento em andamento sem nunca ter chegado a `running`.
 */
const ALLOWED_TRANSITIONS: Record<
  ContainerLifecycleStatus,
  readonly ContainerLifecycleStatus[]
> = {
  provisioning: ['running', 'failed', 'removed'],
  running: ['stopped', 'failed'],
  stopped: ['running', 'failed', 'removed'],
  failed: ['provisioning', 'removed'],
  removed: ['provisioning'],
};

export function canTransition(
  from: ContainerLifecycleStatus,
  to: ContainerLifecycleStatus,
): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function assertTransition(
  from: ContainerLifecycleStatus,
  to: ContainerLifecycleStatus,
): void {
  if (!canTransition(from, to)) {
    throw new InvalidContainerTransitionError(from, to);
  }
}
