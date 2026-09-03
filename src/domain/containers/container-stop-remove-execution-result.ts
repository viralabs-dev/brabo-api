import type { ContainerLifecycleStatus } from './container-lifecycle';

// Resultado da execução de uma ação `container_stop` OU `container_remove`
// (ADR 0136/RN-495). Guardado em `proposed_actions.execution_result`.
//
// Mais simples que `ContainerStartExecutionResult` de propósito: as duas
// ações não decidem imagem nenhuma (não chamam `DecidirImagemDoProjetoUseCase`),
// só pedem ao broker para agir sobre o container que já existe e registram o
// que aconteceu. Um tipo só para as duas — a FORMA é idêntica, só o
// `statusFinal` possível muda (`stopped` para uma, `removed` para a outra).
export interface ContainerStopOuRemoveExecutionResult {
  /** `null` no sucesso — preenchido só na falha, com o motivo da recusa. */
  motivo: string | null;
  /**
   * O estado REGISTRADO depois da execução — `null` na falha. Pode não ser
   * `stopped`/`removed` quando a transição pedida já estava satisfeita (ex.:
   * `container_stop` num projeto já `stopped`): a linha não se move, e o
   * status devolvido é o que já valia.
   */
  statusFinal: ContainerLifecycleStatus | null;
}
