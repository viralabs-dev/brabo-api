import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ApiToEngineClient } from '../../ports/api-to-engine-client.port';
import { ProjectRepository } from '../../ports/project-repository.port';
import {
  RunnerDeviceKeyRepository,
  type ChaveDeDispositivoResumo,
} from '../../ports/runner-device-key-repository.port';

/**
 * Revoga a PRÓPRIA chave — mesmo desenho de `RevokePersonalAccessTokenUseCase`
 * — e alcança também a CONEXÃO VIVA (RN-520, ADR 0147 ponto 6). Desde o
 * ADR 0201 (RN-685) o alvo dessa queda é a CHAVE, e não mais o par
 * `{projeto, usuário}`.
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
 * ## O alvo é a CHAVE (ADR 0201)
 *
 * O ticket do socket guarda, desde o ADR 0201, QUAL credencial o pediu (o
 * `kid`, que é o id do registro — RN-475). Então a queda pede ao engine UMA
 * coisa: derrubar toda conexão aberta com ESTA chave, em qualquer projeto, e
 * anular os tickets dela ainda não usados (`disconnectRunnerCredential`).
 * Outro runner do mesmo usuário, aberto com outra chave ou com PAT, fica de
 * pé — era o custo que a RN-520 declarava, e é o que esta revisão fecha.
 *
 * Para a chave de MÁQUINA (RN-543, ADR 0154) isso deixa de ser o par
 * `{projeto, usuário}` aplicado N vezes: o engine pergunta a TODO runner
 * conectado com que credencial ele nasceu, então a chave cai em todo projeto
 * em que abriu conexão — inclusive num que a lista abaixo não tenha.
 *
 * ## Para que a lista de projetos ainda serve
 *
 * Para duas coisas de TRANSIÇÃO, nenhuma delas o alvo:
 *
 * 1. a conexão LEGADA — aberta com ticket emitido antes do ADR 0201, sem
 *    credencial gravada — cai pelo par usuário/projeto, e só nos projetos
 *    desta lista (`alcanceLegado`);
 * 2. o PLANO B: se o engine não atende o pedido por chave (um engine anterior
 *    a esta rota responde 404 durante o rollout), a queda volta ao alvo
 *    antigo, um `disconnectRunnerOfUser` por projeto. Derrubar a mais
 *    é reversível — o runner reconecta com a credencial que ainda vale —;
 *    deixar de derrubar reabriria a RN-519.
 *
 * A lista é um projeto para a chave de PROJETO, e os CANDIDATOS
 * (`listRunnerModeReachableBy`) para a de MÁQUINA, sem o filtro de papel:
 * desconectar não é decisão de autorização.
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

    const projetos = await this.projetosAlcancados(revogada, userId);
    await this.derrubarConexoesDaChave(revogada.id, userId, projetos);
    return revogada;
  }

  /**
   * Um projeto para a chave de PROJETO; todos os projetos em modo `runner`
   * que o dono alcança para a de MÁQUINA. Enumerar projeto NUNCA pode fazer
   * o `DELETE` falhar, pela mesma régua da desconexão: a revogação já está
   * gravada quando se chega aqui — e, desde o ADR 0201, uma lista vazia não
   * impede a queda por chave, só o alcance legado e o plano B.
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
        'Chave de dispositivo de MÁQUINA revogada, mas os projetos do ' +
          `alcance legado não puderam ser lidos: ${mensagemDe(erro)}`,
      );
      return [];
    }
  }

  private async derrubarConexoesDaChave(
    chaveId: string,
    userId: string,
    projetos: string[],
  ): Promise<void> {
    try {
      const balanco = await this.engine.disconnectRunnerCredential(
        { tipo: 'device_key', id: chaveId },
        { userId, projectIds: projetos },
      );
      this.logger.log(
        `Chave de dispositivo ${chaveId} revogada: ${balanco.derrubados} ` +
          `conexão(ões) dela derrubada(s), ${balanco.legados} legada(s), ` +
          `${balanco.ticketsAnulados} ticket(s) pendente(s) anulado(s), ` +
          `${balanco.semResposta} runner(s) sem resposta`,
      );
    } catch (erro) {
      this.logger.warn(
        `Chave de dispositivo ${chaveId} revogada, mas o engine não atendeu ` +
          `a desconexão por chave (${mensagemDe(erro)}); caindo no alvo ` +
          'antigo, {projeto, usuário}, para não deixar a conexão de pé',
      );
      for (const projectId of projetos) {
        await this.derrubarPeloPar(projectId, userId);
      }
    }
  }

  private async derrubarPeloPar(
    projectId: string,
    userId: string,
  ): Promise<void> {
    try {
      const desfecho = await this.engine.disconnectRunnerOfUser(
        projectId,
        userId,
      );
      this.logger.log(
        `Chave de dispositivo revogada em ${projectId}: desconexão do runner pelo par — ${desfecho}`,
      );
    } catch (erro) {
      this.logger.warn(
        `Chave de dispositivo revogada em ${projectId}, mas a desconexão do ` +
          `runner não pôde ser pedida ao engine: ${mensagemDe(erro)}`,
      );
    }
  }
}

function mensagemDe(erro: unknown): string {
  return erro instanceof Error ? erro.message : String(erro);
}
