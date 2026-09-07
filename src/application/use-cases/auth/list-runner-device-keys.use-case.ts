import { Injectable } from '@nestjs/common';
import {
  RunnerDeviceKeyRepository,
  type ChaveDeDispositivoResumo,
} from '../../ports/runner-device-key-repository.port';

/**
 * Lista SÓ as chaves de dispositivo do próprio usuário naquele projeto
 * (RN-519) — escopado no WHERE do repositório, mesmo desenho de
 * `ListPersonalAccessTokensUseCase`.
 *
 * Ninguém revoga o que não consegue ver: até aqui o controller tinha `@Post()`
 * e `@Delete()` e listagem NENHUMA, então uma chave órfã (aba fechada no meio
 * do fluxo do ADR 0118) era invisível e permanente.
 *
 * A visão de `maintainer` (listar/revogar de QUALQUER usuário do projeto, o
 * que o PAT tem desde a RN-427) continua fora — agora por decisão, não por
 * omissão: chave de dispositivo não é segredo compartilhado que possa vazar
 * num laptop desligado (a privada nunca sai do navegador que a gerou), então
 * o caso de resposta a incidente que justificou aquelas duas rotas não se
 * repete aqui com a mesma força.
 */
@Injectable()
export class ListRunnerDeviceKeysUseCase {
  constructor(private readonly deviceKeys: RunnerDeviceKeyRepository) {}

  execute(
    userId: string,
    projectId: string,
  ): Promise<ChaveDeDispositivoResumo[]> {
    return this.deviceKeys.listarDoUsuarioNoProjeto(userId, projectId);
  }
}
