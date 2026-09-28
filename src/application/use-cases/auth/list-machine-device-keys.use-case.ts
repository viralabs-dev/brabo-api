import { Injectable } from '@nestjs/common';
import {
  RunnerDeviceKeyRepository,
  type ChaveDeDispositivoResumo,
} from '../../ports/runner-device-key-repository.port';

/**
 * Lista as chaves de MÁQUINA do PRÓPRIO usuário, por CONTA e sem projeto
 * nenhum (RN-611).
 *
 * ## Por que existe, se a de máquina já aparecia em toda listagem de projeto
 *
 * Aparecia — desde a RN-543 — em TODA listagem de projeto, e isso é o
 * problema numa instalação que ainda não tem projeto: a instalação de uma
 * linha cria a conta e a chave de máquina ANTES de qualquer projeto (RN-547,
 * RN-552), e `GET /projects/:projectId/runner-device-keys` não tinha contra o
 * que responder. A chave ficava viva e inalcançável, e nem a seção da RN-561
 * a via. A decisão do mantenedor (AT-118) foi abrir a rota por CONTA.
 *
 * ## O que ela NÃO é
 *
 * Não é "todas as minhas chaves": as de PROJETO continuam na seção do projeto
 * delas, onde o alcance de revogá-las (o projeto DELA) é dito. E não é visão
 * de `maintainer`: o `userId` vem do JWT de sessão e vai para o WHERE, e
 * nenhum parâmetro deixa pedir as chaves de outra pessoa (RN-519).
 *
 * Revogadas INCLUÍDAS, pela mesma razão da RN-519: sumir com a linha faria a
 * tela afirmar que a chave nunca existiu — e aqui ainda mais, porque
 * "registrar substitui a anterior" (RN-552) revoga sem tela a chave da
 * reinstalação passada, e é por esta lista que a pessoa vê que isso houve.
 */
@Injectable()
export class ListMachineDeviceKeysUseCase {
  constructor(private readonly deviceKeys: RunnerDeviceKeyRepository) {}

  execute(userId: string): Promise<ChaveDeDispositivoResumo[]> {
    return this.deviceKeys.listarDeMaquinaDoUsuario(userId);
  }
}
