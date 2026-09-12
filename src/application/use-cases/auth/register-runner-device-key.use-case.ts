import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ProjectRepository } from '../../ports/project-repository.port';
import {
  RunnerDeviceKeyRepository,
  type ChaveDeDispositivoResumo,
} from '../../ports/runner-device-key-repository.port';
import {
  exigirJwkPublicaEd25519,
  JwkDeDispositivoInvalidaError,
} from '../../../domain/auth/jwk-de-dispositivo';

/**
 * Registra a chave PÚBLICA de um dispositivo do runner local (Ed25519,
 * gerada no navegador) — a segunda forma de autenticar
 * `POST /projects/:projectId/runner-ticket`, ao lado do Personal Access
 * Token (`IssuePersonalAccessTokenUseCase`). Não confere
 * `executionMode === 'runner'` pela mesma razão daquele use case: quem
 * revalida o modo na hora de USAR é `RequestRunnerTicketUseCase`.
 *
 * A validação de forma da JWK é MÍNIMA de propósito, e desde a RN-552 ela
 * mora no DOMÍNIO (`exigirJwkPublicaEd25519`), não mais aqui: com a chave de
 * MÁQUINA (ADR 0154) passou a haver um segundo registrador — o `install.sh`,
 * pela rota interna —, e uma segunda cópia da checagem divergiria da primeira.
 * O que o caso de uso faz com ela é TRADUZIR: `JwkDeDispositivoInvalidaError`
 * é erro de domínio, e sem esta tradução uma JWK torta sairia 500.
 */
@Injectable()
export class RegisterRunnerDeviceKeyUseCase {
  constructor(
    private readonly deviceKeys: RunnerDeviceKeyRepository,
    private readonly projects: ProjectRepository,
  ) {}

  async execute(input: {
    userId: string;
    projectId: string;
    name: string;
    publicKeyJwk: string;
  }): Promise<ChaveDeDispositivoResumo> {
    const project = await this.projects.findById(input.projectId);
    if (!project) throw new NotFoundException('Projeto não encontrado');

    try {
      exigirJwkPublicaEd25519(input.publicKeyJwk);
    } catch (erro) {
      if (erro instanceof JwkDeDispositivoInvalidaError) {
        throw new BadRequestException(erro.message);
      }
      throw erro;
    }

    return this.deviceKeys.registrar({
      userId: input.userId,
      projectId: input.projectId,
      name: input.name,
      publicKeyJwk: input.publicKeyJwk,
    });
  }
}
