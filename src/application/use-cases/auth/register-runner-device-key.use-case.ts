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

/**
 * Registra a chave PÚBLICA de um dispositivo do runner local (Ed25519,
 * gerada no navegador) — a segunda forma de autenticar
 * `POST /projects/:projectId/runner-ticket`, ao lado do Personal Access
 * Token (`IssuePersonalAccessTokenUseCase`). Não confere
 * `executionMode === 'runner'` pela mesma razão daquele use case: quem
 * revalida o modo na hora de USAR é `RequestRunnerTicketUseCase`.
 *
 * A validação de forma da JWK é MÍNIMA de propósito — só o suficiente pra
 * recusar cedo o que nunca vai verificar uma assinatura EdDSA
 * (`kty`/`crv`/`x`). Validação profunda (a chave é mesmo um ponto Ed25519
 * válido) fica pro `jose.importJWK` quando o guard for USAR a chave —
 * duplicar essa checagem aqui não pega nada que a rejeição na emissão do
 * JWT não pegaria depois, e complicaria esta borda sem necessidade.
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

    validarFormaDaJwk(input.publicKeyJwk);

    return this.deviceKeys.registrar({
      userId: input.userId,
      projectId: input.projectId,
      name: input.name,
      publicKeyJwk: input.publicKeyJwk,
    });
  }
}

function validarFormaDaJwk(publicKeyJwk: string): void {
  let jwk: unknown;
  try {
    jwk = JSON.parse(publicKeyJwk);
  } catch {
    throw new BadRequestException('publicKeyJwk não é um JSON válido');
  }

  if (typeof jwk !== 'object' || jwk === null) {
    throw new BadRequestException('publicKeyJwk precisa ser um objeto JWK');
  }

  const { kty, crv, x } = jwk as Record<string, unknown>;
  if (kty !== 'OKP' || crv !== 'Ed25519' || typeof x !== 'string' || !x) {
    throw new BadRequestException(
      'publicKeyJwk precisa ser uma chave pública Ed25519 (kty "OKP", crv "Ed25519", "x" presente)',
    );
  }
}
