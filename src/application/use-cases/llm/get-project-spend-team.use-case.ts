import { Injectable } from '@nestjs/common';
import {
  TokenUsageRepository,
  type SpendScopeAmplo,
} from '../../ports/token-usage-repository.port';
import { areaDo } from '../../../domain/agents/agent-areas';
import { comoLinhas, somarTotais, type SpendLinha } from './spend-report';

export interface ProjectSpendTeam {
  projectId: string;
  dias: number;
  totalMicros: number;
  assinaturaMicros: number;
  inputTokens: number;
  outputTokens: number;
  chamadas: number;
  porAgente: SpendLinha[];
  /** Agentes agrupados pela área do catálogo; sem área, `chave: 'sem-area'`. */
  porArea: SpendLinha[];
}

/**
 * O gasto do PROJETO visto pelo MEMBRO (AT-632, RN-953, ADR 0233 — revê o 0063):
 * total e custo por agente/área, NUNCA provider/credencial. A rota exige
 * `viewer`, o escopo é o do projeto (sem ator) e este caso de uso só pede a
 * dimensão `actor` — `provider` não é pedido em lugar nenhum daqui.
 */
@Injectable()
export class GetProjectSpendTeamUseCase {
  constructor(private readonly tokenUsage: TokenUsageRepository) {}

  async execute(projectId: string, dias: number): Promise<ProjectSpendTeam> {
    const escopo: SpendScopeAmplo = { projectId, dias };
    const porAtor = await this.tokenUsage.sumGroupedBy('actor', escopo);
    const agentes = comoLinhas(porAtor.filter((l) => l.actorKind === 'agent'));
    const totais = somarTotais(porAtor);

    const areas = new Map<string, SpendLinha>();
    for (const a of agentes) {
      const chave = areaDo(a.chave)?.key ?? 'sem-area';
      const acc = areas.get(chave) ?? {
        chave,
        rotulo: null,
        actorKind: null,
        costMicros: 0,
        assinaturaMicros: 0,
        inputTokens: 0,
        outputTokens: 0,
        chamadas: 0,
      };
      acc.costMicros += a.costMicros;
      acc.assinaturaMicros += a.assinaturaMicros;
      acc.inputTokens += a.inputTokens;
      acc.outputTokens += a.outputTokens;
      acc.chamadas += a.chamadas;
      areas.set(chave, acc);
    }

    return {
      projectId,
      dias,
      totalMicros: totais.costMicros,
      assinaturaMicros: totais.assinaturaMicros,
      inputTokens: totais.inputTokens,
      outputTokens: totais.outputTokens,
      chamadas: totais.chamadas,
      porAgente: agentes,
      porArea: [...areas.values()].sort((x, y) => y.costMicros - x.costMicros),
    };
  }
}
