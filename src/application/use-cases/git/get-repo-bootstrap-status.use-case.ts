import { Injectable } from '@nestjs/common';
import { RepoBootstrapRepository } from '../../ports/repo-bootstrap-repository.port';
import { ProposedActionRepository } from '../../ports/proposed-action-repository.port';
import {
  deriveProvisioningStatus,
  type ProvisioningStatus,
} from '../../../domain/git/repo-bootstrap-status';
import type { BootstrapStepName } from '../../../domain/git/repo-bootstrap.entity';
import type { ProposedAction } from '../../../domain/actions/proposed-action.entity';

export interface RepoBootstrapStatus {
  status: ProvisioningStatus | null;
  // Sessão dedicada do bootstrap — a tela de progresso do web puxa os
  // session_events (bootstrap.step_*) dela pra montar o checklist ao vivo.
  sessionId: string | null;
  failedStep: BootstrapStepName | null;
  lastError: string | null;
  attempts: number;
}

/**
 * A falha de `git_repo_create` mais recente do projeto, se a última tentativa
 * de criar o repositório tiver fracassado.
 *
 * `listByProjectAndType` já existia (a seção de arquitetura a usa para as
 * ADRs); reusá-la evita um método de port novo para uma consulta que só roda
 * no caminho em que NÃO há linha de bootstrap — ou seja, nunca no caminho
 * feliz nem durante o bootstrap em andamento.
 *
 * Olha só a MAIS RECENTE, e só se ela falhou: um projeto que falhou, foi
 * retomado e converge não pode continuar reportando o fracasso antigo.
 */
function motivoDaFalhaDeCriacao(acoes: ProposedAction[]): string | null {
  const ultima = acoes.reduce<ProposedAction | null>(
    (mais, a) => (mais === null || a.seq > mais.seq ? a : mais),
    null,
  );
  if (ultima === null || ultima.status !== 'failed') return null;

  // `'kind' in ...` antes de comparar: a união de `executionResult` NÃO é
  // discriminada — `TerminalExecutionResult` não tem `kind` nenhum. Mesmo
  // idioma de `record-gate-verdict.use-case.ts:196`.
  const resultado = ultima.executionResult;
  const detalhe =
    resultado !== null &&
    'kind' in resultado &&
    resultado.kind === 'git_bootstrap' &&
    typeof resultado.detail.error === 'string'
      ? resultado.detail.error
      : null;

  // Nunca `null` quando a ação falhou: sem a frase do provider, a tela
  // continuaria sem ter o que dizer — e o que ela precisa saber primeiro é
  // QUE falhou. A frase genérica é o piso, não o normal.
  return detalhe ?? 'A criação do repositório falhou sem detalhe registrado.';
}

@Injectable()
export class GetRepoBootstrapStatusUseCase {
  constructor(
    private readonly repoBootstraps: RepoBootstrapRepository,
    private readonly proposedActions: ProposedActionRepository,
  ) {}

  async execute(projectId: string): Promise<RepoBootstrapStatus> {
    const row = await this.repoBootstraps.findByProjectId(projectId);

    // Só quando não há cursor: com linha, ela é a fonte, e uma segunda
    // consulta por request seria custo constante para responder o que já se
    // sabe.
    const falhaDeCriacao =
      row === null
        ? motivoDaFalhaDeCriacao(
            await this.proposedActions.listByProjectAndType(
              projectId,
              'git_repo_create',
            ),
          )
        : null;

    return {
      status: deriveProvisioningStatus(row, falhaDeCriacao),
      sessionId: row?.sessionId ?? null,
      // Sem passo: o repositório não chegou a existir, então nenhum dos seis
      // passos do Gitflow foi tentado. Nomear um seria inventar.
      failedStep: row?.status === 'failed' ? row.step : null,
      lastError: row?.status === 'failed' ? row.lastError : falhaDeCriacao,
      attempts: row?.attempts ?? 0,
    };
  }
}
