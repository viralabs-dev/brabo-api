import { Injectable, NotFoundException } from '@nestjs/common';
import {
  RunnerDeviceKeyRepository,
  type ChaveDeDispositivoResumo,
} from '../../ports/runner-device-key-repository.port';
import { RevokeRunnerDeviceKeyUseCase } from './revoke-runner-device-key.use-case';

/**
 * Revoga uma chave de MÁQUINA do PRÓPRIO usuário pela CONTA (RN-611).
 *
 * ## Nenhuma revogação nova: é a MESMA, com uma porta mais estreita
 *
 * Quem revoga de fato é `RevokeRunnerDeviceKeyUseCase` — a gravação por
 * `{id, usuário}` e, desde o ADR 0201 (RN-685), a queda cujo alvo é a CHAVE:
 * toda conexão aberta com ela, em qualquer projeto, e nenhuma outra do mesmo
 * dono. Numa instalação SEM projeto não há conexão a derrubar — o agente de
 * máquina que espera o primeiro projeto (RN-550) só consulta a lista —, e o
 * próximo ticket que ele pedir é recusado.
 *
 * ## A porta mais estreita
 *
 * A rota por conta existe para a chave de MÁQUINA, e só para ela: uma chave
 * de PROJETO que chegue aqui responde 404, a MESMA resposta de chave que não
 * existe ou que é de outra pessoa. Revogá-la pela Conta seria derrubar o
 * agente num projeto que esta tela não nomeia; ela tem casa, a seção do
 * projeto dela. A pergunta vai à MESMA listagem da tela (`userId` no WHERE),
 * então não há como perguntar pela chave alheia e aprender que ela existe.
 */
@Injectable()
export class RevokeMachineDeviceKeyUseCase {
  constructor(
    private readonly deviceKeys: RunnerDeviceKeyRepository,
    private readonly revogar: RevokeRunnerDeviceKeyUseCase,
  ) {}

  async execute(id: string, userId: string): Promise<ChaveDeDispositivoResumo> {
    const minhas = await this.deviceKeys.listarDeMaquinaDoUsuario(userId);
    if (!minhas.some((chave) => chave.id === id)) {
      throw new NotFoundException('Chave de máquina não encontrada');
    }
    return this.revogar.execute(id, userId);
  }
}
