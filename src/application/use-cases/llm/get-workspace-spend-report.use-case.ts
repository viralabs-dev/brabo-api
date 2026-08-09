import { Injectable } from '@nestjs/common';
import { TokenUsageRepository } from '../../ports/token-usage-repository.port';
import { WorkspaceRepository } from '../../ports/workspace-repository.port';
import {
  comoLinhas,
  densificarPorDia,
  somarTotais,
  type SpendLinha,
  type SpendPorDia,
} from './spend-report';

export interface WorkspaceSpendReport {
  workspaceId: string;
  /** Dono das chaves — quem banca os agentes deste workspace (RN-058). */
  ownerId: string;
  dias: number;
  totalMicros: number;
  inputTokens: number;
  outputTokens: number;
  chamadas: number;
  porModelo: SpendLinha[];
  porProjeto: SpendLinha[];
  porAtor: SpendLinha[];
  porDia: SpendPorDia[];
}

/**
 * O gasto do workspace INTEIRO — a audiência do owner (FASE 22, RN-101).
 *
 * Responde as perguntas que `token_usage` sempre soube responder e nenhuma
 * agregação fazia: em que MODELO o dinheiro foi, em que PROJETO, por conta de
 * QUEM (agente ou pessoa) e em que RITMO.
 *
 * O que este relatório deliberadamente NÃO tem é o eixo de PROVIDER. Não é
 * esquecimento: quebrar por provider é quebrar por credencial, e essa é a
 * pergunta da fatura — que continua respondida, exclusivamente, por
 * `GetCredentialSpendUseCase` e pela rota `credential-spend` ([RN-060]). As
 * duas convivem na mesma tela do owner porque ele é a única audiência que pode
 * ver as duas; o membro nunca alcança nenhuma das duas.
 *
 * Uma nota sobre a dimensão `model`: dois providers servindo o MESMO nome de
 * modelo caem na mesma linha. É de propósito — separá-los reintroduziria o
 * eixo de provider por outro nome, e "quanto custou rodar este modelo" não
 * depende de por onde ele foi servido.
 */
@Injectable()
export class GetWorkspaceSpendReportUseCase {
  constructor(
    private readonly tokenUsage: TokenUsageRepository,
    private readonly workspaces: WorkspaceRepository,
  ) {}

  async execute(
    workspaceId: string,
    dias: number,
    agora = new Date(),
  ): Promise<WorkspaceSpendReport> {
    const escopo = { workspaceId, dias };

    const [workspace, porModelo, porProjeto, porAtor, porDia] =
      await Promise.all([
        this.workspaces.findById(workspaceId),
        this.tokenUsage.sumGroupedBy('model', escopo),
        this.tokenUsage.sumGroupedBy('project', escopo),
        this.tokenUsage.sumGroupedBy('actor', escopo),
        this.tokenUsage.sumGroupedBy('day', escopo),
      ]);

    // O total sai do recorte por ATOR e não da soma das quatro: qualquer um dos
    // quatro cobre as mesmas linhas, e somar mais de um daria o gasto contado
    // N vezes.
    const totais = somarTotais(porAtor);

    return {
      workspaceId,
      ownerId: workspace?.createdBy ?? '',
      dias,
      totalMicros: totais.costMicros,
      inputTokens: totais.inputTokens,
      outputTokens: totais.outputTokens,
      chamadas: totais.chamadas,
      porModelo: comoLinhas(porModelo),
      porProjeto: comoLinhas(porProjeto),
      porAtor: comoLinhas(porAtor),
      porDia: densificarPorDia(porDia, dias, agora),
    };
  }
}
