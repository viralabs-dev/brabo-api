import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ApiToEngineClient } from '../../ports/api-to-engine-client.port';
import {
  RunnerDeviceKeyRepository,
  type ChaveDeDispositivoResumo,
} from '../../ports/runner-device-key-repository.port';

/**
 * Revoga a PRÓPRIA chave — mesmo desenho de `RevokePersonalAccessTokenUseCase`
 * — e, desde a RN-520 (ADR 0147 ponto 6), alcança também a CONEXÃO VIVA.
 *
 * ## As duas metades, e por que só uma delas pode falhar
 *
 * A revogação em si é a linha no banco: é ela que impede ticket NOVO, e é ela
 * que responde 404 quando a chave não existe ou não é do chamador. Derrubar o
 * runner já conectado é EFEITO COLATERAL — o engine fora do ar, nenhum runner
 * conectado, ou um timeout não podem fazer o `DELETE` (204, idempotente)
 * falhar nem virar 5xx. Por isso a chamada ao engine mora dentro de um
 * `try/catch` que só LOGA, a mesma régua de `rag_searches` (RN-479) e do
 * `mirror_sync_result` (RN-517): gravar/propagar telemetria jamais derruba o
 * que ela mede.
 *
 * A ordem também não é negociável: revoga PRIMEIRO, derruba depois. O
 * contrário deixaria uma janela em que o runner cai e reconecta com a chave
 * ainda válida.
 *
 * ## O projeto vem da LINHA revogada, nunca da URL
 *
 * O `projectId` da rota é ignorado no `DELETE` desde sempre (`_projectId` no
 * controller) — o que amarra a chave a um projeto é a coluna, e é dela que
 * sai o alvo da desconexão. Ler da URL faria um `projectId` divergente
 * derrubar o runner de um projeto que não tem nada com esta chave.
 *
 * ## A precisão que existe, e a que não existe
 *
 * O alvo é `{projeto, usuário}`, nunca `{chave}`: a identidade da credencial
 * que originou o ticket do socket morre no `PatAuthGuard` e nunca chega ao
 * engine (`Engine.Runners.SocketTicket` guarda `project_id`/`user_id`/`kind`
 * e nada mais). Custo DECLARADO: um runner do mesmo usuário conectado com
 * PAT, ou com outra chave do mesmo projeto, também cai — e reconecta sozinho,
 * porque a rodada seguinte pede um ticket novo e a credencial que ainda vale
 * ganha um. Quem foi revogado não ganha.
 */
@Injectable()
export class RevokeRunnerDeviceKeyUseCase {
  private readonly logger = new Logger(RevokeRunnerDeviceKeyUseCase.name);

  constructor(
    private readonly deviceKeys: RunnerDeviceKeyRepository,
    private readonly engine: ApiToEngineClient,
  ) {}

  async execute(id: string, userId: string): Promise<ChaveDeDispositivoResumo> {
    const revogada = await this.deviceKeys.revogar(
      id,
      userId,
      'user_requested',
    );
    if (!revogada) throw new NotFoundException('Chave não encontrada');

    await this.derrubarConexaoViva(revogada.projectId, userId);
    return revogada;
  }

  private async derrubarConexaoViva(
    projectId: string,
    userId: string,
  ): Promise<void> {
    try {
      const desfecho = await this.engine.disconnectRunnerOfUser(
        projectId,
        userId,
      );
      this.logger.log(
        `Chave de dispositivo revogada em ${projectId}: desconexão do runner — ${desfecho}`,
      );
    } catch (erro) {
      this.logger.warn(
        `Chave de dispositivo revogada em ${projectId}, mas a desconexão do ` +
          `runner não pôde ser pedida ao engine: ${
            erro instanceof Error ? erro.message : String(erro)
          }`,
      );
    }
  }
}
