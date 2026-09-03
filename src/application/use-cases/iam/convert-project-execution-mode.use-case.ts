import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UnitOfWork } from '../../ports/unit-of-work.port';
import { ProjectRepository } from '../../ports/project-repository.port';
import { PermissionsFileStore } from '../../ports/permissions-file-store.port';
import { DevAgentActivityPort } from '../../ports/dev-agent-activity.port';
import { ContainerRepository } from '../../ports/container-repository.port';
import { RegistrarTransicaoDeContainerUseCase } from '../containers/registrar-transicao-de-container.use-case';
import type {
  Project,
  ProjectExecutionMode,
  ProjectWorkspaceLocation,
} from '../../../domain/iam/project.entity';
import { validarExecutionModeEWorkspacePath } from '../../services/workspace-location';
import { Traced } from '../../../infrastructure/observability/traced.decorator';

export interface ConvertProjectExecutionModeInput {
  executionMode: ProjectExecutionMode;
  workspacePath?: string | null;
}

/**
 * Converte o `execution_mode` de um projeto EXISTENTE (RN-447..450, ADR
 * 0111) — fecha a correção que a Onda 1 do runner (ADR 0104) já tinha
 * registrado em `docs/explanation/backlog.md`: o item 4 daquele ADR dizia
 * que a conversão "passa a ser permitida sem recriar o projeto", e isso
 * não era verdade até esta entrega — `UpdateProjectDto` continuava
 * excluindo `executionMode`/`workspacePath` de propósito, porque não é um
 * `PATCH` trivial (o worktree, o `permissions.json` e o ciclo de vida do
 * container apontam para o escopo antigo).
 *
 * ## Por que uma rota DEDICADA, e não afrouxar `UpdateProjectDto`
 *
 * `UpdateProjectUseCase`/`UpdateProjectDto` continuam intocados. Editar
 * nome/slug é uma coluna; converter modo de execução é uma ORQUESTRAÇÃO —
 * checar dev agent ativo, mover o `permissions.json`, encerrar o container
 * (quando saindo de `container`) e só então gravar a coluna, tudo numa
 * transação. Misturar as duas coisas num único DTO faria o caso simples
 * carregar a complexidade do caso raro.
 *
 * ## O risco de concorrência que esta orquestração existe para prevenir
 *
 * Um dev agent RODANDO não re-resolve o worktree sozinho: `workspace_root`
 * é capturado UMA vez, na criação do worktree, dentro do estado do
 * `Engine.Dev.DevAgentServer` (GenServer) — `Engine.Actions.Workspace.
 * workspace_dir/1,2` e `Engine.Projects.Project.workspace_dir_name/1` são o
 * espelho, do lado engine, de `projectScopeRoot` (a mesma leitura fresca
 * do par modo/caminho, mas cacheada em memória de processo pelo dev
 * agent). Trocar a coluna embaixo de um agente vivo não move o worktree
 * dele — só o PRÓXIMO agente (próxima task reivindicada) resolveria contra
 * o lugar novo, e o antigo continuaria escrevendo no escopo velho, que a
 * política de terminal (ADR 0055) e o `permissions.json` já teriam
 * abandonado.
 *
 * A decisão de projeto é RECUSAR (409) em vez de tentar drenar/migrar o
 * agente vivo — mesmo padrão "recusa e ensina" da RN-088/RN-422: dizer o
 * que falta (esperar o trabalho terminar, ou desbloquear a task travada)
 * em vez de arriscar mover o chão debaixo de um processo em execução.
 */
@Injectable()
export class ConvertProjectExecutionModeUseCase {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly projects: ProjectRepository,
    private readonly permissions: PermissionsFileStore,
    private readonly devAgents: DevAgentActivityPort,
    private readonly containers: ContainerRepository,
    private readonly registrarTransicaoDeContainer: RegistrarTransicaoDeContainerUseCase,
  ) {}

  @Traced('application')
  async execute(
    projectId: string,
    input: ConvertProjectExecutionModeInput,
  ): Promise<Project> {
    const project = await this.projects.findById(projectId);
    if (!project) throw new NotFoundException('Projeto não encontrado');

    // Mesma régua de validação da CRIAÇÃO (RN-170/RN-422/RN-423) — reusada,
    // não duplicada: `mounted` toca disco (existe? é pasta? é gravável?),
    // `runner` só valida o léxico, `container` recusa caminho.
    const novoCaminho = validarExecutionModeEWorkspacePath(
      input.executionMode,
      input.workspacePath,
    );

    // Mesmo (modo, caminho) de hoje: não há o que converter. Devolve o
    // projeto como está sem tocar permissions.json, o ciclo de vida do
    // container nem `workspaceVerifiedAt` — um "converter" que não muda
    // nada não deve mover nada, e não deve derrubar a verificação de um
    // projeto `runner` já confirmado só por repetir a mesma chamada.
    if (
      input.executionMode === project.executionMode &&
      novoCaminho === project.workspacePath
    ) {
      return project;
    }

    // RN-447 — dev agent NÃO-ocioso segura a conversão. Ver o comentário de
    // classe: mudar a raiz de escopo por baixo de um agente vivo é o
    // defeito que este teto existe para prevenir, não uma cautela extra.
    if (await this.devAgents.hasActiveAgents(projectId)) {
      throw new ConflictException(
        'Este projeto tem dev agent trabalhando ou travado agora — a ' +
          'conversão de modo de execução muda a pasta onde o código do ' +
          'agente mora, e um agente já em execução não migra sozinho para ' +
          'o lugar novo. Espere o trabalho terminar (ou desbloqueie a task ' +
          'travada, se algum agente estiver preso) e tente de novo.',
      );
    }

    const localAntiga: ProjectWorkspaceLocation = {
      workspaceDirName: project.workspaceDirName,
      executionMode: project.executionMode,
      workspacePath: project.workspacePath,
    };
    const localNova: ProjectWorkspaceLocation = {
      workspaceDirName: project.workspaceDirName,
      executionMode: input.executionMode,
      workspacePath: novoCaminho,
    };

    return this.unitOfWork.runInTransaction(async () => {
      // RN-449 — saindo de `container` com um container provisionado (ou
      // rodando): leva o ciclo de vida a `removed` ANTES de trocar a
      // coluna. Até o ADR 0135 essa ordem era OBRIGATÓRIA —
      // `RegistrarTransicaoDeContainerUseCase` recusava (400) transicionar
      // o container de um projeto fora do modo `container`, e chamado
      // DEPOIS da troca ele já veria o modo novo e recusaria. O 400 saiu
      // (RN-494, `project_containers` passa a poder existir nos três
      // modos); a ordem CONTINUA a mesma porque segue fazendo sentido por
      // si só — desprovisionar o container real antes de declarar que o
      // projeto deixou de ser `container`, não porque outra recusa force
      // isso. Entrando EM `container` a partir de `mounted`/`runner`:
      // nenhum auto-provisionamento — o portão da imagem (RN-105/494) e o
      // caminho normal do ciclo de vida se aplicam a partir daqui, como
      // para qualquer projeto `container`.
      if (
        project.executionMode === 'container' &&
        input.executionMode !== 'container'
      ) {
        await this.removerContainerSeExistir(projectId);
      }

      // RN-448 — o CONTEÚDO do permissions.json (allow/deny/ask) sobrevive
      // à conversão; só o CAMINHO muda, porque `projectScopeRoot` deriva
      // do par (modo, caminho), não do id do projeto.
      await this.permissions.move(localAntiga, localNova);

      const atualizado = await this.projects.update(projectId, {
        executionMode: input.executionMode,
        workspacePath: novoCaminho,
        // RN-450 — `workspaceVerifiedAt` só faz sentido em `runner`
        // (RN-423); qualquer conversão zera, e o modo `runner` sempre
        // exige uma confirmação NOVA de um runner conectado, mesmo que o
        // caminho reportado acabe sendo igual ao anterior.
        workspaceVerifiedAt: null,
      });

      if (!atualizado) throw new NotFoundException('Projeto não encontrado');
      return atualizado;
    });
  }

  /**
   * `running -> removed` não é transição direta em
   * `domain/containers/container-lifecycle.ts` — passa por `stopped`
   * primeiro. `provisioning`/`stopped`/`failed` vão direto; sem linha
   * nenhuma, ou já `removed`, não há o que fazer.
   */
  private async removerContainerSeExistir(projectId: string): Promise<void> {
    const atual = await this.containers.findByProjectForUpdate(projectId);
    if (!atual || atual.status === 'removed') return;

    if (atual.status === 'running') {
      await this.registrarTransicaoDeContainer.execute(projectId, 'stopped');
    }
    await this.registrarTransicaoDeContainer.execute(projectId, 'removed');
  }
}
