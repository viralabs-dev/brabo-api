import { ConflictException, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { AuthEventRecorder } from '../../ports/auth-event-recorder.port';
import { UnitOfWork } from '../../ports/unit-of-work.port';
import { UserRepository } from '../../ports/user-repository.port';
import { WorkspaceRepository } from '../../ports/workspace-repository.port';
import { assuntoDoUsuario } from '../../../domain/auth/auth-event';
import { ROLE_ORDER, type Role } from '../../../domain/iam/role';
import type { ContextoDaRequisicao } from '../auth/auth-config';
import { EmitirSessaoUseCase } from '../auth/emitir-sessao.use-case';
import { ProvisionarUsuarioUseCase } from '../auth/provisionar-usuario.use-case';

export const SLUG_DO_WORKSPACE_DE_ACESSO_RAPIDO = 'acesso-rapido-local';

export const emailDoPapel = (papel: Role) => `${papel}@brabo.dev`;

/**
 * Acesso rápido por papel (AT-722). Só é montado com o ambiente `local`.
 *
 * Garante as contas `<papel>@brabo.dev` com senha ALEATÓRIA descartada (ninguém
 * a conhece, então a recusa de produção do seed, RN-546, não é tocada) e um
 * workspace próprio onde `owner@` é titular e os demais entram com o seu papel.
 * Sem nenhum usuário na instalação recusa: a `first-account` segue a única
 * porta para a primeira conta. Tudo reaproveita o que já existe.
 */
@Injectable()
export class AcessoRapidoUseCase {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly usuarios: UserRepository,
    private readonly provisionar: ProvisionarUsuarioUseCase,
    private readonly workspaces: WorkspaceRepository,
    private readonly emitir: EmitirSessaoUseCase,
    private readonly eventos: AuthEventRecorder,
  ) {}

  async execute(papel: Role, contexto?: ContextoDaRequisicao) {
    const ids = await this.unitOfWork.runInTransaction(() =>
      this.garantirContas(),
    );
    const userId = ids[papel];
    const sessao = await this.emitir.execute({
      userId,
      email: emailDoPapel(papel),
      contexto,
    });
    await this.eventos.registrar({
      kind: 'dev_login',
      subjectKey: assuntoDoUsuario(userId),
      userId,
      ip: contexto?.ip,
      userAgent: contexto?.userAgent,
      metadata: { papel },
    });
    return sessao;
  }

  private async garantirContas(): Promise<Record<Role, string>> {
    if (!(await this.usuarios.existeAlgumUsuario())) {
      throw new ConflictException(
        'Esta instalação ainda não tem usuário. Crie a primeira conta pelo ' +
          'instalador; o acesso rápido não cria a primeira.',
      );
    }
    const ids = {} as Record<Role, string>;
    for (const papel of ROLE_ORDER) {
      const { user } = await this.provisionar.execute({
        email: emailDoPapel(papel),
        nome: `Acesso rápido (${papel})`,
        senha: randomBytes(32).toString('base64url'),
      });
      ids[papel] = user.id;
    }

    const existentes = await this.workspaces.listForUser(ids.owner);
    const workspace =
      existentes.find(
        (w) => w.workspace.slug === SLUG_DO_WORKSPACE_DE_ACESSO_RAPIDO,
      )?.workspace ??
      (await this.workspaces.create({
        name: 'Acesso rápido (local)',
        slug: SLUG_DO_WORKSPACE_DE_ACESSO_RAPIDO,
        createdBy: ids.owner,
      }));
    for (const papel of ROLE_ORDER) {
      const atual = await this.workspaces.findMemberRole(
        workspace.id,
        ids[papel],
      );
      if (atual !== papel) {
        await this.workspaces.addMember(workspace.id, ids[papel], papel);
      }
    }
    return ids;
  }
}
