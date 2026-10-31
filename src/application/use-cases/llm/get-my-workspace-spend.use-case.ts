import { Injectable } from '@nestjs/common';
import {
  TokenUsageRepository,
  type SpendScopeDeAtor,
} from '../../ports/token-usage-repository.port';
import {
  comoLinhas,
  densificarPorDia,
  somarTotais,
  type SpendLinha,
  type SpendPorDia,
} from './spend-report';

export interface MyWorkspaceSpend {
  workspaceId: string;
  dias: number;
  actorId: string;
  totalMicros: number;
  assinaturaMicros: number;
  inputTokens: number;
  outputTokens: number;
  chamadas: number;
  porProjeto: SpendLinha[];
  porDia: SpendPorDia[];
}

/**
 * O que EU consumi no workspace, somado por projeto (AT-632, RN-953). O ator
 * vem do token; o escopo é de ator, então `provider` nem compila (RN-187).
 */
@Injectable()
export class GetMyWorkspaceSpendUseCase {
  constructor(private readonly tokenUsage: TokenUsageRepository) {}

  async execute(
    workspaceId: string,
    userId: string,
    dias: number,
    agora = new Date(),
  ): Promise<MyWorkspaceSpend> {
    const escopo: SpendScopeDeAtor = {
      workspaceId,
      actor: { kind: 'user' as const, id: userId },
      dias,
    };
    const [porProjeto, porDia] = await Promise.all([
      this.tokenUsage.sumGroupedBy('project', escopo),
      this.tokenUsage.sumGroupedBy('day', escopo),
    ]);
    const totais = somarTotais(porProjeto);
    return {
      workspaceId,
      dias,
      actorId: userId,
      totalMicros: totais.costMicros,
      assinaturaMicros: totais.assinaturaMicros,
      inputTokens: totais.inputTokens,
      outputTokens: totais.outputTokens,
      chamadas: totais.chamadas,
      porProjeto: comoLinhas(porProjeto),
      porDia: densificarPorDia(porDia, dias, agora),
    };
  }
}
