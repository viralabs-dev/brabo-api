import { Injectable, Logger } from '@nestjs/common';
import { ObterCicloDeVidaDoContainerUseCase } from './obter-ciclo-de-vida-do-container.use-case';
import { RegistrarTransicaoDeContainerUseCase } from './registrar-transicao-de-container.use-case';
import { BrokerRecusouError } from '../../ports/container-broker.port';

export const CODIGO_SERVICO_DE_DADOS_MORREU = 'servico_de_dados_morreu';

/** O motivo que vai ao ciclo e à ação; o código novo do broker é tratado pelo nome. */
export function motivoDaSubida(erro: Error): string {
  return erro instanceof BrokerRecusouError &&
    erro.codigo === CODIGO_SERVICO_DE_DADOS_MORREU
    ? `O serviço de dados morreu ao subir: ${erro.message}`
    : erro.message;
}

/**
 * RN-1538 (AT-1015, molde RN-1366/RN-1384): o broker devolveu falha na subida
 * (`start` ou recriação): o ciclo grava `failed` com `failureReason`, que a
 * visão geral (RN-1493) e o contexto da Infra já leem. Ciclo de pé
 * (`running`/`provisioning`/`stopped`) vai direto a `failed`, sem derrubar nada;
 * sem linha ou `removed` (subida nova: o broker já desfez o que criou) passa
 * por `provisioning` primeiro; `failed` já grava o motivo antes e fica como está.
 * Melhor esforço: o motivo da ação não depende desta gravação.
 */
@Injectable()
export class RegistrarFalhaDeSubidaUseCase {
  private readonly logger = new Logger(RegistrarFalhaDeSubidaUseCase.name);

  constructor(
    private readonly obterCicloDeVida: ObterCicloDeVidaDoContainerUseCase,
    private readonly registrarTransicao: RegistrarTransicaoDeContainerUseCase,
  ) {}

  async execute(projectId: string, motivo: string): Promise<void> {
    try {
      const ciclo = await this.obterCicloDeVida.execute(projectId);
      if (ciclo?.status === 'failed') return;
      if (!ciclo || ciclo.status === 'removed') {
        await this.registrarTransicao.execute(projectId, 'provisioning');
      }
      await this.registrarTransicao.execute(projectId, 'failed', {
        failureReason: motivo,
      });
    } catch (erro) {
      this.logger.warn(
        `projeto ${projectId}: não gravei o ciclo failed (${erro instanceof Error ? erro.name : 'erro'})`,
      );
    }
  }
}
