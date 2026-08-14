import { Injectable } from '@nestjs/common';
import { StoryRepository } from '../../ports/backlog-repository.port';
import { SessionEventRepository } from '../../ports/session-event-repository.port';
import { computeCoverage } from '../../../domain/backlog/coverage';

/** Uma regra de negócio do projeto, com o estado de cobertura dela. */
export interface BusinessRuleWithCoverage {
  id: string;
  title: string;
  description: string;
  /** Ids das histórias que citam esta regra em `businessRuleIds`. */
  coveredByStoryIds: string[];
  covered: boolean;
}

export interface ProjectBusinessRules {
  rules: BusinessRuleWithCoverage[];
  /** Quantas regras nenhuma história cobre — a pendência do PO. */
  uncoveredCount: number;
}

/**
 * As regras de negócio do projeto INTEIRO, com cobertura, para o PO LER
 * ([RN-164](../../../../../../docs/business-rules.md#rn-164)).
 *
 * Existe porque o PO só tinha ferramenta de ESCRITA: ele lia o contexto uma
 * vez, no kickoff, a partir dos 200 últimos eventos da SESSÃO dele, e depois
 * disso nunca mais relia nada. Numa sessão longa — ou numa retomada — ele não
 * sabia quais regras existiam nem quais já tinha coberto, e o backlog saía
 * incompleto sem que nada acusasse.
 *
 * Não é uma segunda `GetCoverageUseCase`: aquela responde "quanto do produto
 * já virou história" para a TELA, e por isso devolve só título. Esta responde
 * "o que eu preciso transformar em história" para o MODELO, e por isso carrega
 * a `description` — sem ela o PO teria o enunciado da regra e não o conteúdo.
 * O cálculo de cobertura em si é o MESMO (`computeCoverage`, puro): duas
 * contas do mesmo fato divergiriam no primeiro ajuste.
 */
@Injectable()
export class ListBusinessRulesUseCase {
  constructor(
    private readonly sessionEvents: SessionEventRepository,
    private readonly stories: StoryRepository,
  ) {}

  async execute(projectId: string): Promise<ProjectBusinessRules> {
    const [ruleEvents, stories] = await Promise.all([
      this.sessionEvents.listByTypeForProject(
        projectId,
        'artifact.business_rule',
      ),
      this.stories.findByProject(projectId),
    ]);

    const descricaoPorId = new Map<string, string>();
    for (const evento of ruleEvents) {
      const payload = evento.payload as { description?: string } | null;
      descricaoPorId.set(evento.id, payload?.description ?? '');
    }

    const relatorio = computeCoverage(
      ruleEvents.map((e) => ({
        id: e.id,
        title:
          (e.payload as { title?: string } | null)?.title ??
          '(regra sem título)',
      })),
      stories.map((s) => ({
        id: s.id,
        title: s.title,
        businessRuleIds: s.businessRuleIds,
      })),
    );

    return {
      rules: relatorio.rules.map((r) => ({
        id: r.ruleId,
        title: r.title,
        description: descricaoPorId.get(r.ruleId) ?? '',
        coveredByStoryIds: r.coveredByStoryIds,
        covered: r.covered,
      })),
      uncoveredCount: relatorio.uncoveredCount,
    };
  }
}
