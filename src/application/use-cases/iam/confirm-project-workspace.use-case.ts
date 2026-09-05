import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ProjectRepository } from '../../ports/project-repository.port';
import { UnitOfWork } from '../../ports/unit-of-work.port';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';
import {
  caminhoDeWorkspaceLocalValido,
  normalizarSemBarraFinal,
} from '../../../infrastructure/filesystem/project-workspaces-root';

export interface ConfirmProjectWorkspaceInput {
  path: string;
  sessionId?: string | null;
  actorId?: string | null;
}

export interface ConfirmProjectWorkspaceResult {
  verified: true;
  workspacePath: string;
  changed: boolean;
}

/**
 * O runner confirma o caminho de um projeto `execution_mode: runner`
 * (RN-423, ADR 0104) — mesmo espírito de `RecordGateVerdictUseCase`: uma
 * mutação de estado + um evento de auditoria (quando possível), na MESMA
 * transação.
 *
 * ## O runner é a fonte da verdade (decisão confirmada com o usuário)
 *
 * Diferente do modo `mounted` (onde o caminho é fixado na criação e a pasta é
 * materializada por `materializarWorkspaceMontado`), aqui a confirmação
 * SOBRESCREVE
 * `workspacePath` com o que o runner reportou — ele é quem roda no host de
 * verdade, e é mais autoritativo que o que o usuário digitou no wizard. A
 * checagem LÉXICA (`caminhoDeWorkspaceLocalValido`) continua rodando
 * incondicionalmente: ela é sobre a AUTORIZAÇÃO do terminal (ADR 0055), não
 * sobre "quem decide o caminho" — um path fora de escopo é rejeitado mesmo
 * vindo do runner.
 *
 * ## Idempotência
 *
 * Reconectar reportando o MESMO caminho não regrava `workspaceVerifiedAt`
 * (`changed: false`) — só uma primeira confirmação, ou uma que reporta
 * caminho DIFERENTE do gravado, mexe no banco.
 *
 * ## A lacuna aceita (decisão confirmada com o usuário)
 *
 * `sessionId` pode ser `null`/ausente quando o projeto ainda não tem
 * sessão nenhuma (`Engine.Sessions.ProjectSession.latest_id/1` devolveu
 * `nil`) — mesma degradação que `registrar_evento_terminal/3` já aceita
 * para PTY. O `UPDATE` acontece de qualquer forma; só o evento
 * `project.workspace_verified` (e portanto a evidência do gate
 * `workspace-verificado`) fica ausente nesse caso.
 */
@Injectable()
export class ConfirmProjectWorkspaceUseCase {
  constructor(
    private readonly projects: ProjectRepository,
    private readonly unitOfWork: UnitOfWork,
    private readonly appendEvent: AppendSessionEventUseCase,
  ) {}

  async execute(
    projectId: string,
    input: ConfirmProjectWorkspaceInput,
  ): Promise<ConfirmProjectWorkspaceResult> {
    const project = await this.projects.findById(projectId);
    if (!project) throw new NotFoundException('Projeto não encontrado');

    if (project.executionMode !== 'runner') {
      throw new BadRequestException(
        `Projeto no modo "${project.executionMode}" não usa confirmação de ` +
          'runner (RN-423) — só o modo "runner" tem workspace verificado ' +
          'por essa via.',
      );
    }

    const bruto = input.path.trim();
    if (!caminhoDeWorkspaceLocalValido(bruto)) {
      throw new BadRequestException(
        `Caminho reportado pelo runner é inválido: ${JSON.stringify(bruto)}. ` +
          'Precisa ser absoluto, sem ".." em nenhum segmento, fora da raiz ' +
          'e das pastas de sistema, e não pode se sobrepor ao checkout do ' +
          'próprio Brabo.',
      );
    }
    const normalizado = normalizarSemBarraFinal(bruto);

    const changed =
      project.workspaceVerifiedAt === null ||
      project.workspacePath !== normalizado;

    if (changed) {
      await this.unitOfWork.runInTransaction(async () => {
        await this.projects.update(projectId, {
          workspacePath: normalizado,
          workspaceVerifiedAt: new Date(),
        });

        if (input.sessionId) {
          try {
            await this.appendEvent.execute(projectId, input.sessionId, {
              type: 'project.workspace_verified',
              actor: { kind: 'user', id: input.actorId ?? 'desconhecido' },
              payload: { workspacePath: normalizado },
            });
          } catch {
            // Lacuna aceita (RN-423): sessão referenciada não existe (mais)
            // — o UPDATE já aconteceu, só a auditoria fica sem o evento.
          }
        }
      });
    }

    return { verified: true, workspacePath: normalizado, changed };
  }
}
