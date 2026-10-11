import { Injectable } from '@nestjs/common';
import { GetSessionContextSummaryUseCase } from '../sessions/get-session-context-summary.use-case';
import {
  SessionContextSummaryRepository,
  TETO_DE_ARQUIVOS_TOCADOS,
  TETO_DE_PRS_LIDAS,
  type ArquivoTocado,
  type ResumoDoContextoDaSessao,
} from '../../ports/session-context-summary-repository.port';
import { ReadProjectCodeUseCase } from './read-project-code.use-case';

/**
 * RN-844 (AT-513) — o resumo do painel "Contexto da sessão" com os arquivos
 * das PRs. As PRs do agente não carregam a lista de arquivos no payload, então
 * "Arquivos tocados" ficava vazio do começo ao fim; aqui eles vêm do MESMO
 * diff que a aba PRs lê (`ReadProjectCodeUseCase.pullRequestDiff`).
 *
 * Mora no módulo de git porque é ele que lê o repositório (o de sessões é
 * importado por ele, e o inverso faria ciclo). Leitura contida (ADR 0060):
 * sem parâmetro livre, no máximo `TETO_DE_PRS_LIDAS` diffs por chamada; PR
 * fora do teto ou cujo diff falhou entra em `prsNaoLidas`, nunca some calada.
 */
@Injectable()
export class ResumirContextoDaSessaoUseCase {
  constructor(
    private readonly resumoBase: GetSessionContextSummaryUseCase,
    private readonly repo: SessionContextSummaryRepository,
    private readonly codigo: ReadProjectCodeUseCase,
  ) {}

  async execute(
    projectId: string,
    sessionId: string,
  ): Promise<ResumoDoContextoDaSessao> {
    // 404 para sessão de outro projeto mora aqui dentro.
    const resumo = await this.resumoBase.execute(projectId, sessionId);
    const prs = await this.repo.prsDasSessoes(
      projectId,
      resumo.sessoesLidas,
      TETO_DE_PRS_LIDAS,
    );
    if (prs.total === 0) return resumo;

    const diffs = await Promise.allSettled(
      prs.itens.map((pr) =>
        this.codigo.pullRequestDiff(projectId, pr.pullRequestId),
      ),
    );
    const daPr: ArquivoTocado[] = [];
    let falhas = 0;
    diffs.forEach((d, i) => {
      if (d.status === 'rejected') {
        falhas += 1;
        return;
      }
      for (const f of d.value.files) {
        daPr.push({
          actionId: prs.itens[i].actionId,
          path: f.path,
          additions: f.additions,
          deletions: f.deletions,
        });
      }
    });

    const itens = [...daPr, ...resumo.arquivosTocados.itens].slice(
      0,
      TETO_DE_ARQUIVOS_TOCADOS,
    );
    return {
      ...resumo,
      arquivosTocados: {
        itens,
        total: daPr.length + resumo.arquivosTocados.total,
        prsNaoLidas: prs.total - prs.itens.length + falhas,
      },
    };
  }
}
