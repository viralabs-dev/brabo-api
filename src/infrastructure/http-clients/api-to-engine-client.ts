import { Injectable } from '@nestjs/common';
import { CABECALHO_SERVICE_TOKEN } from '../../interfaces/http/auth/engine-service.guard';
import { tokenDeServicoAtual } from '../security/service-token';
import { injectTraceHeaders } from '../observability/trace-context';
import { Traced } from '../observability/traced.decorator';
import { ApiToEngineClient } from '../../application/ports/api-to-engine-client.port';
import type { TerminalExecutionResult } from '../../domain/actions/terminal-execution-result';
import type { DevAgentImpl } from '../../domain/execution/dev-agent-impl';

/**
 * Comando síncrono api -> engine: cria o processo de sessão
 * supervisionado quando a sessão transiciona pra 'active' — substitui o
 * antigo consumo de session.created via outbox do lado do engine.
 * Auth simétrica à direção engine->api desde a Fase 7a: o mesmo segredo
 * compartilhado (`BRABO_SERVICE_TOKEN`) em cabeçalho próprio, verificado pelo
 * `VerifyServiceToken` do lado Elixir.
 *
 * Não há mais cache de token: antes era preciso guardar o client-credentials
 * do Keycloak até expirar; agora o valor é uma variável de ambiente, e ler uma
 * env a cada chamada custa menos do que a invalidação que o cache exigia.
 */
@Injectable()
export class HttpApiToEngineClient implements ApiToEngineClient {
  @Traced('infrastructure')
  async startSession(
    sessionId: string,
    projectId: string,
    traceParent?: string | null,
  ): Promise<void> {
    const engineUrl = process.env.ENGINE_URL ?? 'http://localhost:4000';

    const res = await fetch(`${engineUrl}/internal/sessions`, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify({ sessionId, projectId, traceParent }),
    });

    if (!res.ok) {
      throw new Error(
        `Falha ao criar sessão no engine: ${res.status} ${await res.text()}`,
      );
    }
  }

  async executeTerminalAction(
    projectId: string,
    sessionId: string,
    actionId: string,
    command: string,
    cwd?: string,
  ): Promise<TerminalExecutionResult> {
    const engineUrl = process.env.ENGINE_URL ?? 'http://localhost:4000';

    const res = await fetch(`${engineUrl}/internal/actions/execute`, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify({ projectId, sessionId, actionId, command, cwd }),
    });

    if (!res.ok) {
      throw new Error(
        `Falha ao executar ação de terminal no engine: ${res.status} ${await res.text()}`,
      );
    }

    return (await res.json()) as TerminalExecutionResult;
  }

  async startAgent(
    projectId: string,
    sessionId: string,
    agent: string,
  ): Promise<void> {
    await this.postCommand(`/internal/sessions/${sessionId}/agent/start`, {
      projectId,
      agent,
    });
  }

  async sendAgentMessage(
    projectId: string,
    sessionId: string,
    agent: string,
    text: string,
  ): Promise<void> {
    await this.postCommand(`/internal/sessions/${sessionId}/agent/message`, {
      projectId,
      agent,
      text,
    });
  }

  async confirmReadiness(projectId: string, sessionId: string): Promise<void> {
    await this.postCommand(`/internal/sessions/${sessionId}/agent/readiness`, {
      projectId,
    });
  }

  async offerInfraHandoff(projectId: string, sessionId: string): Promise<void> {
    await this.postCommand(
      `/internal/sessions/${sessionId}/agent/offer-infra-handoff`,
      { projectId },
    );
  }

  async reanalyzeSession(projectId: string, sessionId: string): Promise<void> {
    await this.postCommand(
      `/internal/sessions/${sessionId}/psychologist/reanalyze`,
      { projectId },
    );
  }

  async runAnamnese(projectId: string): Promise<void> {
    await this.postCommand(`/internal/projects/${projectId}/anamnese/run`, {});
  }

  async invalidateInstructions(
    projectId: string,
    agent: string,
  ): Promise<void> {
    await this.postCommand(
      `/internal/projects/${projectId}/agents/${agent}/instructions/invalidate`,
      {},
    );
  }

  async startExecution(
    projectId: string,
    sessionId: string,
    modules: string[],
    taskBudgetMicros?: number,
    maxGateCorrections?: number,
    impl?: DevAgentImpl,
    maxConsecutiveBlocked?: number,
  ): Promise<void> {
    await this.postCommand(`/internal/sessions/${sessionId}/execution/start`, {
      projectId,
      modules,
      taskBudgetMicros,
      maxGateCorrections,
      impl,
      maxConsecutiveBlocked,
    });
  }

  async acceptParallelization(
    projectId: string,
    sessionId: string,
    module: string,
  ): Promise<void> {
    await this.postCommand(
      `/internal/sessions/${sessionId}/execution/parallelize`,
      { projectId, module },
    );
  }

  async rearmDevAgent(
    projectId: string,
    sessionId: string,
    agentId: string,
  ): Promise<void> {
    await this.postCommand(
      `/internal/sessions/${sessionId}/dev-agents/${agentId}/rearm`,
      { projectId },
    );
  }

  async reviseStory(
    projectId: string,
    sessionId: string,
    storyId: string,
    title: string,
    reason: string,
  ): Promise<void> {
    await this.postCommand(`/internal/sessions/${sessionId}/agent/revise`, {
      projectId,
      storyId,
      title,
      reason,
    });
  }

  async executeGitAction(
    projectId: string,
    sessionId: string,
    actionId: string,
    type: string,
    payload: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const engineUrl = process.env.ENGINE_URL ?? 'http://localhost:4000';

    const res = await fetch(`${engineUrl}/internal/actions/execute-git`, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify({ projectId, sessionId, actionId, type, payload }),
    });

    if (!res.ok) {
      throw new Error(
        `Falha ao executar ação git no engine: ${res.status} ${await res.text()}`,
      );
    }
    return (await res.json()) as Record<string, unknown>;
  }

  /**
   * Headers de toda chamada api -> engine, num lugar só (Fase 5, item 3).
   *
   * Antes eram quatro blocos idênticos montados inline, e o `traceparent`
   * teria que ser lembrado em cada um — o tipo de duplicação em que um
   * esquecimento não quebra nada, só produz uma trace partida que ninguém
   * relaciona ao endpoint que faltou.
   */
  private buildHeaders(): Record<string, string> {
    return injectTraceHeaders({
      'Content-Type': 'application/json',
      [CABECALHO_SERVICE_TOKEN]: tokenDeServicoAtual(),
    });
  }

  @Traced('infrastructure')
  private async postCommand(
    path: string,
    body: Record<string, unknown>,
  ): Promise<void> {
    const engineUrl = process.env.ENGINE_URL ?? 'http://localhost:4000';

    const res = await fetch(`${engineUrl}${path}`, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(
        `Falha no comando ao engine (${path}): ${res.status} ${await res.text()}`,
      );
    }
  }
}
