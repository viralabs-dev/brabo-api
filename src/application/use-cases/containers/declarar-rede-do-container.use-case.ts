import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { SessionRepository } from '../../ports/session-repository.port';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';
import {
  ObterRedeDoContainerUseCase,
  type RedeVigente,
} from './obter-rede-do-container.use-case';
import {
  EVENTO_REDE_DO_CONTAINER,
  RedeInvalidaError,
  validarRedeDoContainer,
  type RedeDoContainer,
} from '../../../domain/containers/rede-do-container';

/**
 * Um humano (`maintainer`) declara a rede do container (AT-608, RN-931). Emite
 * nova versão de `artifact.container_network` na sessão mais recente do
 * projeto (o log é por sessão). NÃO é efeito externo: só vale ao recriar.
 */
@Injectable()
export class DeclararRedeDoContainerUseCase {
  constructor(
    private readonly sessions: SessionRepository,
    private readonly appendEvent: AppendSessionEventUseCase,
    private readonly obter: ObterRedeDoContainerUseCase,
  ) {}

  async execute(
    projectId: string,
    userId: string,
    entrada: unknown,
  ): Promise<RedeVigente> {
    let rede: RedeDoContainer;
    try {
      rede = validarRedeDoContainer(entrada);
    } catch (e) {
      if (e instanceof RedeInvalidaError) {
        throw new BadRequestException({
          code: 'rede_invalida',
          campo: e.campo,
          message: e.message,
        });
      }
      throw e;
    }
    const todas = await this.sessions.listForProject(projectId);
    const sessao = [...todas].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    )[0];
    if (!sessao) {
      throw new ConflictException({
        code: 'sem_sessao',
        message: 'O projeto não tem sessão onde registrar a rede.',
      });
    }
    const version = ((await this.obter.execute(projectId))?.version ?? 0) + 1;
    await this.appendEvent.execute(projectId, sessao.id, {
      type: EVENTO_REDE_DO_CONTAINER,
      actor: { kind: 'user', id: userId },
      payload: { ...rede, version },
    });
    return { ...rede, version };
  }
}
