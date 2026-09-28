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
 * Quem revoga de fato é `RevokeRunnerDeviceKeyUseCase`, sem mudança — a
 * gravação por `{id, usuário}` e, para a chave de máquina, a desconexão
 * PLURAL que ele já fazia: um `disconnectRunnerOfUser` por projeto em modo
 * `runner` que o dono alcança (RN-520/RN-543). O alvo da desconexão continua
 * `{projeto, usuário}` e nunca `{chave}`: esta rota não o muda, e mudar é
 * frente própria, com ADR (AT-013). Numa instalação SEM projeto a lista de
 * projetos é vazia, então a revogação só grava a linha — e é o que basta: o
 * agente de máquina que espera o primeiro projeto (RN-550) não tem conexão
 * nenhuma a derrubar, e o próximo ticket que ele pedir é recusado.
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
