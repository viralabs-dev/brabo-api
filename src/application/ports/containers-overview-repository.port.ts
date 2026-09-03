import type { ProjectContainerLifecycle } from '../../domain/containers/container-lifecycle';
import type { ProposedAction } from '../../domain/actions/proposed-action.entity';

/** Uma linha da página global de containers (ADR 0136, RN-495). */
export interface ContainerOverviewRow {
  projectId: string;
  projectName: string;
  projectSlug: string;
  /** O REGISTRADO — a linha inteira de `project_containers` para o projeto. */
  lifecycle: ProjectContainerLifecycle;
  /**
   * A imagem CONGELADA em `lifecycle.imageVersion` — string, para exibição.
   * `null` quando o evento daquela versão não foi encontrado (schema
   * degradado, ou versão referenciando um evento que nunca existiu de
   * verdade) — nunca inventada.
   */
  imagem: string | null;
  /**
   * A `proposed_action` PENDENTE de `container_start`/`container_stop`/
   * `container_remove` deste projeto, se houver — em QUALQUER sessão dele
   * (mesmo cruzamento project-wide de `ListProjectPendingActionsUseCase`,
   * ADR 0136). A tela usa isto para mostrar o `ApprovalCard` inline em vez
   * do botão de ação, no mesmo molde de `ProjectPrsTab`. Se mais de uma
   * estiver pendente ao mesmo tempo (não impedido pelo domínio), a mais
   * RECENTE (maior `seq`) vence — são casos raros e a tela mostra uma
   * decisão de cada vez.
   */
  acaoPendente: ProposedAction | null;
}

/**
 * Read model da página global de containers — mesmo espírito de
 * `ProjectsSummaryRepository` (cross-projeto, sem N+1): UMA consulta junta
 * `projects` com `project_containers` (INNER JOIN — só entra quem já TEM
 * linha de ciclo de vida, que é a régua da tela: "cada projeto que já tem
 * `project_containers`"), outra busca em lote os eventos
 * `artifact.project_image` dos projetos encontrados (para resolver a
 * imagem-texto de cada `imageVersion` congelado), e uma terceira busca em
 * lote as `proposed_actions` pendentes de container dos mesmos projetos.
 * TRÊS consultas, quantos projetos forem — nenhuma dentro de laço.
 *
 * NÃO inclui o estado OBSERVADO (pergunta ao broker) — isso é
 * responsabilidade do USE CASE que consome este repositório
 * (`ObterVisaoGeralDeContainersUseCase`), porque perguntar ao broker é uma
 * chamada de REDE por projeto, sujeita a orçamento (ADR 0060), e não faz
 * sentido nenhum numa consulta SQL.
 */
export abstract class ContainersOverviewRepository {
  abstract listForWorkspace(
    workspaceId: string,
  ): Promise<ContainerOverviewRow[]>;
}
