import { Injectable, NotFoundException } from '@nestjs/common';
import {
  RunnerDeviceKeyRepository,
  type ChaveDeDispositivoResumo,
} from '../../ports/runner-device-key-repository.port';

/** Revoga a PRÓPRIA chave — mesmo desenho de `RevokePersonalAccessTokenUseCase`. */
@Injectable()
export class RevokeRunnerDeviceKeyUseCase {
  constructor(private readonly deviceKeys: RunnerDeviceKeyRepository) {}

  async execute(id: string, userId: string): Promise<ChaveDeDispositivoResumo> {
    const revogada = await this.deviceKeys.revogar(
      id,
      userId,
      'user_requested',
    );
    if (!revogada) throw new NotFoundException('Chave não encontrada');
    return revogada;
  }
}
