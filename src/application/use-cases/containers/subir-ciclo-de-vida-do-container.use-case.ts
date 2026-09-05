import { Injectable } from '@nestjs/common';
import { ObterCicloDeVidaDoContainerUseCase } from './obter-ciclo-de-vida-do-container.use-case';
import { RegistrarTransicaoDeContainerUseCase } from './registrar-transicao-de-container.use-case';
import { Traced } from '../../../infrastructure/observability/traced.decorator';

/**
 * A dança `provisioning -> running` (ADR 0081/0130/0133), extraída
 * (RN-508, ADR 0145) de `ExecuteContainerStartUseCase` — que a passou a
 * COMPARTILHAR com `ExecuteContainerStartViaRunnerUseCase` (`runner`, sem
 * eleição de imagem nenhuma) em vez de duplicar o mesmo racional da máquina
 * de estados nos dois arquivos.
 *
 * Por que `stopped` pula direto para `running`: a máquina de estados
 * (`container-lifecycle.ts`) exige que a PRIMEIRA linha de um projeto nasça
 * em `provisioning` — é essa transição que lê a decisão de imagem vigente e
 * CONGELA `imageVersion`/`resources` na linha nova. Sem linha ainda, ou com
 * a linha marcada `failed`/`removed` (as duas sem container de pé),
 * replicamos esse ciclo completo: `provisioning` (nasce/renasce a linha) e
 * só então `running` (o broker/runner confirmou que subiu).
 *
 * `stopped` já tem linha viva com `imageVersion` gravado — reprovisionar
 * reemitiria uma imagem que pode já estar desatualizada em relação à que
 * acabamos de decidir, e a máquina de estados nem permite `stopped ->
 * provisioning` (só `stopped -> running/failed/removed`). Por isso vai
 * direto para `running`: é o broker/runner reconectando a um container que
 * a tabela já sabia que existia, não provisionando um novo.
 *
 * `provisioning`/`running` já vivos: quem subiu é idempotente — só falta
 * completar a transição pendente (`provisioning -> running`) ou não fazer
 * nada (já `running`).
 */
@Injectable()
export class SubirCicloDeVidaDoContainerUseCase {
  constructor(
    private readonly obterCicloDeVida: ObterCicloDeVidaDoContainerUseCase,
    private readonly registrarTransicao: RegistrarTransicaoDeContainerUseCase,
  ) {}

  @Traced('application')
  async execute(projectId: string, containerId: string): Promise<void> {
    const atual = await this.obterCicloDeVida.execute(projectId);

    if (!atual || atual.status === 'failed' || atual.status === 'removed') {
      await this.registrarTransicao.execute(projectId, 'provisioning');
    }

    if (!atual || atual.status !== 'running') {
      await this.registrarTransicao.execute(projectId, 'running', {
        containerId,
      });
    }
    // atual.status === 'running': nada a transicionar, já está de pé.
  }
}
