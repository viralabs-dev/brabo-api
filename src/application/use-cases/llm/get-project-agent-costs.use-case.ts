import { Injectable } from '@nestjs/common';
import {
  TokenUsageRepository,
  type AgentTokenUsage,
} from '../../ports/token-usage-repository.port';

/**
 * Custo por agente no projeto, nos últimos 30 dias.
 *
 * É o número que a coluna "EST. MÊS" e o card "Custo estimado mensal do time"
 * da tela de Configurações pedem desde o mockup (`design/SCREENS.md`) e que
 * até aqui era um traço fixo na tela — o dado existia em `token_usage`, faltava
 * a agregação por projeto.
 *
 * "Estimado" é literal: é o gasto OBSERVADO nos últimos 30 dias, não uma
 * projeção. Um agente que nunca rodou não aparece na lista, e a tela mostra
 * traço para ele — o que é diferente de mostrar zero, que afirmaria um agente
 * ativo e gratuito.
 */
@Injectable()
export class GetProjectAgentCostsUseCase {
  constructor(private readonly tokenUsage: TokenUsageRepository) {}

  execute(projectId: string): Promise<AgentTokenUsage[]> {
    return this.tokenUsage.sumByProjectGroupedByAgentLast30Days(projectId);
  }
}
