import { Injectable } from '@nestjs/common';
import {
  ContainersOverviewRepository,
  type ContainerOverviewRow,
} from '../../ports/containers-overview-repository.port';
import type { ProposedAction } from '../../../domain/actions/proposed-action.entity';
import {
  ObterEstadoObservadoDoContainerUseCase,
  type EstadoObservado,
} from './obter-estado-observado-do-container.use-case';
import { Traced } from '../../../infrastructure/observability/traced.decorator';

/**
 * Por que uma linha não foi perguntada ao broker NESTE carregamento — nunca
 * confundido com `EstadoObservado.naoObservado` (esse é sobre o broker ter
 * sido perguntado e não ter respondido/recusado; este é sobre a linha nem
 * ter entrado na pergunta).
 */
export type MotivoDeNaoVerificacao =
  /** Registrado `stopped`/`failed`/`removed` — a divergência não importa
   *  aqui: um container parado/descartado não precisa de confirmação do
   *  daemon para a tela fazer sentido. */
  | 'fora_do_escopo_da_verificacao'
  /** Elegível (`provisioning`/`running`), mas o carregamento já perguntou
   *  ao broker o máximo de vezes que se permite de uma vez. */
  | 'teto_de_verificacoes_atingido';

/**
 * `observado`/`naoObservado`/`detalheDaObservacao` achatados aqui, no MESMO
 * formato de `CicloDeVidaDoContainerResponseDto` (a rota por projeto) — os
 * três só têm sentido lido em conjunto quando `naoVerificado` é `null` (a
 * linha FOI perguntada ao broker neste carregamento). Quando `naoVerificado`
 * não é `null`, os três vêm vazios: a linha nem entrou na pergunta, e
 * preenchê-los com o motivo do broker seria inventar uma resposta que ele
 * nunca deu.
 */
export interface ContainerOverviewItem {
  projectId: string;
  projectName: string;
  projectSlug: string;
  registrado: ContainerOverviewRow['lifecycle'];
  imagem: string | null;
  observado: EstadoObservado['observado'] | null;
  naoObservado: EstadoObservado['naoObservado'] | null;
  detalheDaObservacao: EstadoObservado['detalhe'] | null;
  naoVerificado: MotivoDeNaoVerificacao | null;
  /** A `proposed_action` pendente de container deste projeto, se houver — ver `ContainerOverviewRow.acaoPendente`. */
  acaoPendente: ProposedAction | null;
}

/**
 * Teto de chamadas ao broker POR CARREGAMENTO da página (ADR 0060/0136,
 * RN-495) — a mesma disciplina de `RN-180`/RN-092: toda leitura composta que
 * chama um provider externo N vezes declara um orçamento, em vez de crescer
 * sem teto com o número de projetos.
 *
 * Por que 20, e por que a régua é por STATUS antes do teto entrar em jogo:
 * um container `stopped`/`failed`/`removed` não precisa de confirmação do
 * daemon para a tela fazer sentido (ninguém espera que ele esteja de pé) —
 * só `provisioning`/`running` são elegíveis, e são exatamente os casos em
 * que "registrado diz uma coisa, container real diz outra" (RN-486)
 * importa de verdade. Na prática o número de containers *provisionando ou
 * rodando* ao mesmo tempo é pequeno (FASE 25b: nenhum provisionamento
 * automático existe ainda, só `container_start` manual por aprovação), então
 * 20 é folga generosa, não um corte apertado — e é um NÚMERO, revisável, não
 * "todos".
 */
export const TETO_DE_VERIFICACOES_POR_CARGA = 20;

const STATUS_ELEGIVEIS_PARA_VERIFICACAO = new Set(['provisioning', 'running']);

/**
 * A página global de containers (ADR 0136, RN-495): o REGISTRADO de todo
 * projeto do workspace que já tem `project_containers` (via
 * `ContainersOverviewRepository`, sem N+1), com o OBSERVADO pedido ao broker
 * só para quem é elegível E está dentro do teto — as duas metades nunca se
 * fundem (RN-468/486), e quem ficou de fora do teto DIZ por quê, distinto de
 * "o broker não respondeu".
 */
@Injectable()
export class ObterVisaoGeralDeContainersUseCase {
  constructor(
    private readonly overview: ContainersOverviewRepository,
    private readonly obterEstadoObservado: ObterEstadoObservadoDoContainerUseCase,
  ) {}

  @Traced('application')
  async execute(workspaceId: string): Promise<ContainerOverviewItem[]> {
    const linhas = await this.overview.listForWorkspace(workspaceId);

    const elegiveis = linhas.filter((l) =>
      STATUS_ELEGIVEIS_PARA_VERIFICACAO.has(l.lifecycle.status),
    );
    const dentroDoTeto = new Set(
      elegiveis
        .slice(0, TETO_DE_VERIFICACOES_POR_CARGA)
        .map((l) => l.projectId),
    );

    // Em paralelo, nunca em série: são chamadas de REDE independentes, e
    // encadeá-las multiplicaria a latência pelo teto à toa.
    const pares = await Promise.all(
      [...dentroDoTeto].map(
        async (projectId) =>
          [
            projectId,
            await this.obterEstadoObservado.execute(projectId),
          ] as const,
      ),
    );
    const observacoes = new Map(pares);

    return linhas.map((linha) => {
      if (!STATUS_ELEGIVEIS_PARA_VERIFICACAO.has(linha.lifecycle.status)) {
        return this.item(linha, null, 'fora_do_escopo_da_verificacao');
      }
      if (!dentroDoTeto.has(linha.projectId)) {
        return this.item(linha, null, 'teto_de_verificacoes_atingido');
      }
      return this.item(linha, observacoes.get(linha.projectId) ?? null, null);
    });
  }

  private item(
    linha: ContainerOverviewRow,
    estadoObservado: EstadoObservado | null,
    naoVerificado: MotivoDeNaoVerificacao | null,
  ): ContainerOverviewItem {
    return {
      projectId: linha.projectId,
      projectName: linha.projectName,
      projectSlug: linha.projectSlug,
      registrado: linha.lifecycle,
      imagem: linha.imagem,
      observado: estadoObservado?.observado ?? null,
      naoObservado: estadoObservado?.naoObservado ?? null,
      detalheDaObservacao: estadoObservado?.detalhe ?? null,
      naoVerificado,
      acaoPendente: linha.acaoPendente,
    };
  }
}
