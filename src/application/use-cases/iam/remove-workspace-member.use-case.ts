import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ApiToEngineClient } from '../../ports/api-to-engine-client.port';
import { PersonalAccessTokenRepository } from '../../ports/personal-access-token-repository.port';
import { ProjectRepository } from '../../ports/project-repository.port';
import { RunnerDeviceKeyRepository } from '../../ports/runner-device-key-repository.port';
import { UnitOfWork } from '../../ports/unit-of-work.port';
import { WorkspaceRepository } from '../../ports/workspace-repository.port';
import {
  MENSAGEM_TETO_AUTO_REMOCAO_DO_WORKSPACE,
  remocaoEhAutoRebaixamento,
} from '../../../domain/iam/tetos-de-rebaixamento';
import {
  CODIGO_CRIADOR_DO_WORKSPACE,
  MENSAGEM_CRIADOR_DO_WORKSPACE,
  removeOTitular,
} from '../../../domain/iam/titularidade-do-workspace';

/**
 * O motivo gravado em `revoked_reason` pela cascata — o mesmo nas chaves de
 * dispositivo e nos PATs, porque é a mesma causa.
 */
export const MOTIVO_REVOGACAO_POR_REMOCAO_DO_WORKSPACE =
  'workspace_member_removed';

/**
 * Desassocia alguém do WORKSPACE (ADR 0173, RN-615) — a quinta porta da linha
 * dos tetos (ADRs 0127/0156/0157), e a rota que o ADR 0157 recusou criar de
 * passagem.
 *
 * ## O teto é o de sempre, e o último owner sai dele
 *
 * A régua é `remocaoEhAutoRebaixamento`, sem cópia: o papel do ator no
 * workspace entra como o efetivo de hoje e `null` como o papel de DEPOIS. No
 * workspace não há nível acima para segurar a queda, então remover a própria
 * linha é SEMPRE queda para "nenhum acesso" — e a auto-remoção é sempre 403.
 *
 * **O último `owner` está protegido pela MESMA cláusula, sem contar owners.**
 * A rota é `@RequireRole('owner')`, então quem remove é sempre um `owner`; ele
 * nunca remove a si mesmo; logo toda remoção bem-sucedida deixa de pé pelo
 * menos um `owner` — o próprio chamador. Tirar o último exigiria que ele se
 * removesse, que é o movimento recusado. É a mesma demonstração do ADR 0157
 * para o upsert, e o mesmo motivo para não contar: a cláusula não tem número
 * para envelhecer.
 *
 * **Remover OUTRO `owner` continua possível**, e é a forma de revogar
 * propriedade por inteiro — a mesma decisão do ponto 3 do ADR 0157, que manteve
 * rebaixar outro dono. O teto 1 segue sem par neste escopo.
 *
 * ## A cascata, e o que ela NÃO faz
 *
 * Numa transação: a linha de `workspace_members`, as linhas de
 * `project_members` do removido nos projetos DESTE workspace (sem elas, a
 * sobreposição `projectRole ?? workspaceRole` o manteria dentro de todo projeto
 * em que tivesse linha própria), e as credenciais dele presas a esses
 * projetos — as chaves de dispositivo de PROJETO e os PATs (todo PAT é de um
 * projeto). Sem revogá-las, reassociar a pessoa um dia reativaria em silêncio
 * pareamentos que a remoção devia ter encerrado. Depois do commit, a conexão viva do runner dele em cada
 * projeto do workspace cai pelo mesmo caminho da RN-520
 * (`disconnectRunnerOfUser`), em `try/catch` que só loga: efeito colateral
 * nunca derruba o efeito principal.
 *
 * **O TITULAR (`workspaces.created_by`) não sai** (RN-616): 409
 * `criador_do_workspace` até a titularidade ser transferida a outro owner por
 * `TransferWorkspaceOwnershipUseCase` — é dele a credencial que os agentes
 * gastam (RN-058) e o relatório de gasto (RN-060).
 *
 * Fica de fora, declarado no ADR: as chaves de MÁQUINA (são da conta e servem
 * outros workspaces; aqui a autorização já cai pelo papel), sessões abertas e
 * o socket de sessão já
 * conectado.
 */
@Injectable()
export class RemoveWorkspaceMemberUseCase {
  private readonly logger = new Logger(RemoveWorkspaceMemberUseCase.name);

  constructor(
    private readonly workspaces: WorkspaceRepository,
    private readonly projects: ProjectRepository,
    private readonly deviceKeys: RunnerDeviceKeyRepository,
    private readonly pats: PersonalAccessTokenRepository,
    private readonly uow: UnitOfWork,
    private readonly engine: ApiToEngineClient,
  ) {}

  async execute(
    workspaceId: string,
    atorId: string,
    alvoId: string,
  ): Promise<void> {
    const papelDoAtor = await this.workspaces.findMemberRole(
      workspaceId,
      atorId,
    );

    if (
      remocaoEhAutoRebaixamento({
        atorId,
        alvoId,
        // O efetivo de hoje, no workspace, é a própria linha — não há
        // composição. E o papel de DEPOIS é nenhum: não há nível acima.
        papelEfetivoDoAtorNoProjeto: papelDoAtor,
        papelDoAtorNoWorkspace: null,
      })
    ) {
      throw new ForbiddenException(MENSAGEM_TETO_AUTO_REMOCAO_DO_WORKSPACE);
    }

    // O TITULAR não sai enquanto for titular (RN-616): a credencial que os
    // agentes gastam e o relatório de gasto são dele. Depois do teto, de
    // propósito — o titular tentando se remover recebe a frase do teto, que
    // é a que vale para qualquer um.
    const workspace = await this.workspaces.findById(workspaceId);
    if (!workspace) throw new NotFoundException('Workspace não encontrado');
    if (removeOTitular(alvoId, workspace.createdBy)) {
      throw new ConflictException({
        code: CODIGO_CRIADOR_DO_WORKSPACE,
        message: MENSAGEM_CRIADOR_DO_WORKSPACE,
      });
    }

    await this.uow.runInTransaction(async () => {
      await this.workspaces.removeMember(workspaceId, alvoId);
      await this.projects.removeMemberFromWorkspaceProjects(
        workspaceId,
        alvoId,
      );
      await this.deviceKeys.revogarChavesDeProjetoNoWorkspace(
        alvoId,
        workspaceId,
        MOTIVO_REVOGACAO_POR_REMOCAO_DO_WORKSPACE,
      );
      await this.pats.revogarDoUsuarioNoWorkspace(
        alvoId,
        workspaceId,
        MOTIVO_REVOGACAO_POR_REMOCAO_DO_WORKSPACE,
      );
    });

    for (const projectId of await this.projetosDoWorkspace(workspaceId)) {
      await this.derrubarConexaoViva(projectId, alvoId);
    }
  }

  /**
   * TODO projeto do workspace, não só os de modo `runner`: o runner conecta
   * também em `container`/`mounted` (o espelho, RN-516), e sobrar um projeto
   * sem runner custa um `sem_runner`, enquanto faltar um deixa de pé o que a
   * remoção existe para derrubar — o mesmo raciocínio da RN-520.
   */
  private async projetosDoWorkspace(workspaceId: string): Promise<string[]> {
    try {
      const projetos = await this.projects.listForWorkspace(workspaceId);
      return projetos.map((projeto) => projeto.id);
    } catch (erro) {
      this.logger.warn(
        'Membro removido do workspace, mas os projetos a desconectar não ' +
          `puderam ser lidos: ${erro instanceof Error ? erro.message : String(erro)}`,
      );
      return [];
    }
  }

  private async derrubarConexaoViva(
    projectId: string,
    userId: string,
  ): Promise<void> {
    try {
      const desfecho = await this.engine.disconnectRunnerOfUser(
        projectId,
        userId,
      );
      this.logger.log(
        `Membro removido do workspace: desconexão do runner em ${projectId} — ${desfecho}`,
      );
    } catch (erro) {
      this.logger.warn(
        `Membro removido do workspace, mas a desconexão do runner em ${projectId} ` +
          `não pôde ser pedida ao engine: ${
            erro instanceof Error ? erro.message : String(erro)
          }`,
      );
    }
  }
}
