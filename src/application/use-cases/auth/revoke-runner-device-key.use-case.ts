import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ApiToEngineClient } from '../../ports/api-to-engine-client.port';
import { ProjectRepository } from '../../ports/project-repository.port';
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
 * ## E quando a coluna é NULA: a chave de MÁQUINA (RN-543, ADR 0154)
 *
 * Uma chave de máquina não nomeia projeto nenhum, e não há um `projectId` a
 * passar ao engine. Deixar de derrubar seria reabrir exatamente o que a
 * RN-520 fechou — a chave morre para ticket NOVO e as conexões vivas seguem
 * executando comando aprovado —, agora em N conexões em vez de uma.
 *
 * Então o alvo vira PLURAL: cada projeto em modo `runner` que o dono da chave
 * alcança, um `disconnectRunnerOfUser` por projeto. É a consequência que o
 * ADR 0154 declarou por antecipação — *"revogar passará a derrubar todos os
 * projetos daquela máquina"* — e ela cabe sem tocar o engine: a assinatura
 * `{projeto, usuário}` continua byte a byte, só é chamada N vezes.
 *
 * A lista vem dos CANDIDATOS (`listRunnerModeReachableBy`), sem o filtro de
 * papel que `ListRunnerProjectsUseCase` aplica, e isso é deliberado:
 * desconectar não é decisão de autorização — é "quais conexões esta chave
 * poderia ter criado". Sobrar um projeto onde o papel já caiu só derruba uma
 * conexão do PRÓPRIO usuário que, nesse caso, já não podia renovar o ticket;
 * FALTAR um deixaria de pé o que a revogação existe para matar.
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
    private readonly projects: ProjectRepository,
  ) {}

  async execute(id: string, userId: string): Promise<ChaveDeDispositivoResumo> {
    const revogada = await this.deviceKeys.revogar(
      id,
      userId,
      'user_requested',
    );
    if (!revogada) throw new NotFoundException('Chave não encontrada');

    for (const projectId of await this.projetosAlcancados(revogada, userId)) {
      await this.derrubarConexaoViva(projectId, userId);
    }
    return revogada;
  }

  /**
   * Um projeto para a chave de PROJETO; todos os projetos em modo `runner`
   * que o dono alcança para a de MÁQUINA. Enumerar projeto NUNCA pode fazer
   * o `DELETE` falhar, pela mesma régua da desconexão: a revogação já está
   * gravada quando se chega aqui.
   */
  private async projetosAlcancados(
    revogada: ChaveDeDispositivoResumo,
    userId: string,
  ): Promise<string[]> {
    if (revogada.projectId !== null) return [revogada.projectId];

    try {
      const projetos = await this.projects.listRunnerModeReachableBy(userId);
      return projetos.map((projeto) => projeto.id);
    } catch (erro) {
      this.logger.warn(
        'Chave de dispositivo de MÁQUINA revogada, mas os projetos a ' +
          `desconectar não puderam ser lidos: ${
            erro instanceof Error ? erro.message : String(erro)
          }`,
      );
      return [];
    }
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
