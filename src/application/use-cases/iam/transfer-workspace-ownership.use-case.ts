import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { UnitOfWork } from '../../ports/unit-of-work.port';
import { WorkspaceRepository } from '../../ports/workspace-repository.port';
import type { Workspace } from '../../../domain/iam/workspace.entity';
import {
  CODIGO_TITULAR_PRECISA_SER_OWNER,
  MENSAGEM_TITULAR_PRECISA_SER_OWNER,
} from '../../../domain/iam/titularidade-do-workspace';

/**
 * Transfere a TITULARIDADE do workspace — `workspaces.created_by` — para outro
 * `owner` (ADR 0173, RN-616).
 *
 * É o caminho de saída que a recusa da remoção do titular aponta: sem ele,
 * quem criou o workspace nunca sairia dele. O destino precisa JÁ ser `owner`
 * (409 `titular_precisa_ser_owner`), porque ser titular é pagar: a partir do
 * commit, `ResolveCredentialOwnerUseCase` passa a devolver o NOVO titular, e é
 * a credencial DELE que os turnos de agente e as ações de git procuram. Se ele
 * não tiver credencial para o provider do modelo, o turno termina com o
 * desfecho que o produto já tem — "Nenhuma credencial cadastrada para
 * <provider>" em `RunLlmTurnUseCase`/`StreamLlmTurnUseCase` —; a transferência
 * NÃO confere isso de antemão, e o ADR declara por quê.
 *
 * Quem chama é qualquer `owner` (o guard da rota) — inclusive um que não é o
 * titular, e inclusive transferindo para OUTRO owner que não pediu. Isso é
 * declarado, não esquecido: ser `owner` do workspace já é a autoridade máxima
 * sobre ele, e é a mesma que remove e rebaixa outros donos.
 *
 * Não há evento de domínio para mudança de membro nem de titularidade (o
 * upsert e a remoção também não emitem): fica o log. Transferir para quem já é
 * o titular é idempotente.
 */
@Injectable()
export class TransferWorkspaceOwnershipUseCase {
  private readonly logger = new Logger(TransferWorkspaceOwnershipUseCase.name);

  constructor(
    private readonly workspaces: WorkspaceRepository,
    private readonly uow: UnitOfWork,
  ) {}

  async execute(
    workspaceId: string,
    atorId: string,
    destinoId: string,
  ): Promise<Workspace> {
    const transferido = await this.uow.runInTransaction(async () => {
      const workspace = await this.workspaces.findById(workspaceId);
      if (!workspace) throw new NotFoundException('Workspace não encontrado');

      const papelDoDestino = await this.workspaces.findMemberRole(
        workspaceId,
        destinoId,
      );
      if (papelDoDestino !== 'owner') {
        throw new ConflictException({
          code: CODIGO_TITULAR_PRECISA_SER_OWNER,
          message: MENSAGEM_TITULAR_PRECISA_SER_OWNER,
        });
      }

      if (workspace.createdBy === destinoId) return { workspace, de: null };

      const atualizado = await this.workspaces.transferirTitularidade(
        workspaceId,
        destinoId,
      );
      if (!atualizado) {
        throw new NotFoundException('Workspace não encontrado');
      }
      return { workspace: atualizado, de: workspace.createdBy };
    });

    if (transferido.de !== null) {
      this.logger.log(
        `Titularidade do workspace ${workspaceId} transferida de ` +
          `${transferido.de} para ${destinoId} por ${atorId}`,
      );
    }
    return transferido.workspace;
  }
}
