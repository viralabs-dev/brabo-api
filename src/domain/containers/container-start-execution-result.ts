import type { PosturaDeRede, RecursosDoContainer } from './project-container';

// Resultado da execução de uma ação `container_start` (ADR 0130/0133 — a
// Infra elege uma imagem candidatada pelo Arquiteto e sobe o container REAL
// do projeto pelo broker). Guardado em `proposed_actions.execution_result`.
//
// Mesmo desenho de `InfraPrExecutionResult`: UMA forma para os dois
// desfechos. No sucesso, `motivo` é `null` e os campos de container vêm
// preenchidos; na falha, só `motivo` é preenchido (o porquê — imagem fora
// das candidatas, recusa do broker, transição de ciclo de vida inválida) e
// os campos de container ficam `null`/vazios. Explícito em vez de reusar
// `title` como mensagem de erro (como `InfraPrExecutionResult` faz): aqui os
// dois desfechos têm formas de payload bem diferentes (um lado é "subiu com
// esta imagem/rede/recursos", o outro é só "não subiu, e por quê"), e um
// campo nomeado deixa isso explícito em vez de sobrecarregar `imagem`.
export interface ContainerStartExecutionResult {
  /** `null` no sucesso — preenchido só na falha, com o motivo da recusa. */
  motivo: string | null;
  /** A imagem DECIDIDA (DecidirImagemDoProjetoUseCase) — vazia na falha. */
  imagem: string;
  /** Versão do artefato `artifact.project_image` recém-emitido — 0 na falha. */
  version: number;
  network: PosturaDeRede | null;
  resources: RecursosDoContainer | null;
  /** Id do container real reportado pelo broker — `null` na falha. */
  containerId: string | null;
  /** `true` quando o broker já reportava o container de pé (start idempotente). */
  jaEstavaDePe: boolean;
}
