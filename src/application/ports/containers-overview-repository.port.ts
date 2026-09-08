import type { ProjectContainerLifecycle } from '../../domain/containers/container-lifecycle';
import type { ProjectExecutionMode } from '../../domain/iam/project.entity';
import type { ProposedAction } from '../../domain/actions/proposed-action.entity';

/** Uma linha da página global de containers (ADR 0136, RN-495/RN-521). */
export interface ContainerOverviewRow {
  projectId: string;
  projectName: string;
  projectSlug: string;
  /**
   * ONDE o container deste projeto sobe (RN-497/503): `container` e `mounted`
   * pelo BROKER, `runner` pelo agente local na máquina do usuário. É o que
   * ramifica a ação de subida entre `container_start` e
   * `container_start_via_runner` (RN-521) — a tela não adivinha o modo, ela o
   * RECEBE.
   */
  executionMode: ProjectExecutionMode;
  /**
   * O REGISTRADO — a linha inteira de `project_containers` para o projeto, ou
   * `null` quando o projeto NUNCA provisionou um (RN-521).
   *
   * `null` é um TERCEIRO estado, e não um valor novo de
   * `ContainerLifecycleStatus`: não é `stopped` (que é um container que
   * existiu e parou) e não é "não observado" (que é sobre o daemon ter sido
   * perguntado). A linha simplesmente não existe — e é exatamente o caso do
   * projeto cuja PRIMEIRA subida falhou antes de registrar coisa nenhuma, que
   * era o projeto que esta tela não conseguia mostrar.
   */
  lifecycle: ProjectContainerLifecycle | null;
  /**
   * A imagem CONGELADA em `lifecycle.imageVersion` — string, para exibição.
   * `null` quando não há `lifecycle`, e também quando o evento daquela versão
   * não foi encontrado (schema degradado, ou versão referenciando um evento
   * que nunca existiu de verdade) — nunca inventada.
   */
  imagem: string | null;
  /**
   * Há QUALQUER `artifact.project_image` emitido para este projeto — o portão
   * da RN-105, que desde a RN-494/ADR 0135 vale nos TRÊS modos. `false`
   * significa que subir container é impossível AGORA, e a tela diz isso no
   * lugar do botão em vez de propor uma ação que já se sabe que vai falhar.
   *
   * Booleano, e não a decisão inteira, de propósito: quem vai SUBIR busca a
   * decisão vigente no clique (`GET .../container`), e trazer o payload de
   * todo projeto do workspace em toda carga seria pagar por dado que quase
   * nunca é usado.
   */
  temImagemDecidida: boolean;
  /**
   * `projects.workspace_verified_at` — quando um runner CONFIRMOU a pasta
   * (RN-423). Só ganha sentido em `execution_mode: runner`.
   *
   * É registro de UMA confirmação, nunca batimento (RN-468): não-nulo NÃO
   * prova que há agente local conectado agora. O que ele prova é o NEGATIVO —
   * `null` num projeto `runner` quer dizer que nenhum runner jamais conectou,
   * e aí `container_start_via_runner` falharia com certeza.
   */
  workspaceVerifiedAt: Date | null;
  /**
   * A `proposed_action` PENDENTE de `container_start`/`container_stop`/
   * `container_remove`/`container_start_via_runner` deste projeto, se houver
   * — em QUALQUER sessão dele (mesmo cruzamento project-wide de
   * `ListProjectPendingActionsUseCase`, ADR 0136). A tela usa isto para
   * mostrar o `ApprovalCard` inline em vez do botão de ação, no mesmo molde
   * de `ProjectPrsTab`. Se mais de uma estiver pendente ao mesmo tempo (não
   * impedido pelo domínio), a mais RECENTE (maior `seq`) vence — são casos
   * raros e a tela mostra uma decisão de cada vez.
   */
  acaoPendente: ProposedAction | null;
}

/**
 * Read model da página global de containers — mesmo espírito de
 * `ProjectsSummaryRepository` (cross-projeto, sem N+1): UMA consulta junta
 * `projects` com `project_containers` (LEFT JOIN desde a RN-521 — TODO
 * projeto do workspace entra, tenha ele container registrado ou não, porque
 * a tela passou a ser o caminho HUMANO de subir o PRIMEIRO), outra busca em
 * lote os eventos `artifact.project_image` dos projetos encontrados (para
 * resolver a imagem-texto de cada `imageVersion` congelado E para saber quem
 * já tem decisão de imagem), e uma terceira busca em lote as
 * `proposed_actions` pendentes de container dos mesmos projetos. TRÊS
 * consultas, quantos projetos forem — nenhuma dentro de laço.
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
