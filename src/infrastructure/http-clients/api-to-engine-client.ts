import { BadRequestException, Injectable } from '@nestjs/common';
import { CABECALHO_SERVICE_TOKEN } from '../../interfaces/http/auth/engine-service.guard';
import { tokenDeServicoAtual } from '../security/service-token';
import { injectTraceHeaders } from '../observability/trace-context';
import { Traced } from '../observability/traced.decorator';
import {
  ApiToEngineClient,
  RunnerNaoConectadoError,
  RunnerRecusouContainerError,
  type ContainerIniciadoViaRunner,
  type EspecificacaoDeContainerParaRunner,
} from '../../application/ports/api-to-engine-client.port';
import type { TerminalExecutionResult } from '../../domain/actions/terminal-execution-result';
import type { DevAgentImpl } from '../../domain/execution/dev-agent-impl';
import { AnamneseDisabledError } from '../../domain/anamnese/anamnese-disabled.error';
import { PsychologistDisabledError } from '../../domain/psychologist/psychologist-disabled.error';

/**
 * `sessionId`, `projectId` e `agent`/`agentId` viram SEGMENTO DE URL de uma
 * requisição interna api -> engine sem DTO/`class-validator` no meio — nenhum
 * framework confere a forma deles antes da interpolação em template string
 * (RN-128). Mesma largura que `NOME_DE_PASTA_VALIDO` de
 * `project-workspaces-root.ts` aceita para segmento de caminho: hex, hífen e
 * sublinhado, 1 a 64 chars — cabe tanto no UUID que estes campos são hoje
 * quanto num slug de agente (`dev-frontend`), e estreito o bastante para que
 * nada vire segmento de path extra nem quebre a URL montada.
 */
const SEGMENTO_DE_URL_INTERNA_VALIDO = /^[A-Za-z0-9_-]{1,64}$/;

function garantirSegmentoDeUrlInterna(valor: string, nome: string): string {
  if (!SEGMENTO_DE_URL_INTERNA_VALIDO.test(valor)) {
    throw new BadRequestException(
      `${nome} inválido para requisição interna: ${JSON.stringify(valor)}`,
    );
  }
  return valor;
}

/**
 * Forma da resposta (SEMPRE 200) de `POST .../containers/{start,stop,remove}`
 * do engine — ver `EngineWeb.ContainerCommandController`. `motivoCodigo` só
 * vem preenchido quando o engine nem chegou a perguntar ao runner
 * (`RunnerRouter.start_container/2` devolveu `{:error, _}`); sucesso falso
 * SEM `motivoCodigo` é o runner tendo respondido e recusado.
 */
interface RespostaDeContainerViaRunner {
  sucesso: boolean;
  motivo?: string;
  motivoCodigo?: 'not_connected' | 'timeout';
  containerId?: string;
  nome?: string;
  jaEstavaDePe?: boolean;
}

function lancarSeFalhou(
  corpo: RespostaDeContainerViaRunner,
  verbo: string,
): void {
  if (corpo.sucesso) return;

  if (
    corpo.motivoCodigo === 'not_connected' ||
    corpo.motivoCodigo === 'timeout'
  ) {
    throw new RunnerNaoConectadoError(
      corpo.motivoCodigo,
      corpo.motivo ?? 'nenhum runner conectado a este projeto',
    );
  }

  throw new RunnerRecusouContainerError(
    corpo.motivo ?? `o runner recusou ${verbo} o container`,
  );
}

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
    await this.postCommand(
      `/internal/sessions/${sessionId}/agent/start`,
      { projectId, agent },
      [['sessionId', sessionId]],
    );
  }

  async sendAgentMessage(
    projectId: string,
    sessionId: string,
    agent: string,
    text: string,
  ): Promise<void> {
    await this.postCommand(
      `/internal/sessions/${sessionId}/agent/message`,
      { projectId, agent, text },
      [['sessionId', sessionId]],
    );
  }

  async confirmReadiness(projectId: string, sessionId: string): Promise<void> {
    await this.postCommand(
      `/internal/sessions/${sessionId}/agent/readiness`,
      { projectId },
      [['sessionId', sessionId]],
    );
  }

  async cancelAgentTurn(
    projectId: string,
    sessionId: string,
    agent: string,
  ): Promise<void> {
    await this.postCommand(
      `/internal/sessions/${sessionId}/agent/cancel`,
      { projectId, agent },
      [['sessionId', sessionId]],
    );
  }

  async offerInfraHandoff(projectId: string, sessionId: string): Promise<void> {
    await this.postCommand(
      `/internal/sessions/${sessionId}/agent/offer-infra-handoff`,
      { projectId },
      [['sessionId', sessionId]],
    );
  }

  async offerDevHandoff(projectId: string, sessionId: string): Promise<void> {
    await this.postCommand(
      `/internal/sessions/${sessionId}/agent/offer-dev-handoff`,
      { projectId },
      [['sessionId', sessionId]],
    );
  }

  /**
   * Não usa `postCommand`: precisa distinguir o 503 ("Psicólogo desativado
   * globalmente", RN — ver `PsychologistDisabledError`) de qualquer outra
   * falha de transporte, e `postCommand` colapsa todo `!res.ok` num `Error`
   * genérico que perde o status. Mesmo tratamento de `runAnamnese` abaixo.
   */
  async reanalyzeSession(projectId: string, sessionId: string): Promise<void> {
    sessionId = garantirSegmentoDeUrlInterna(sessionId, 'sessionId');
    const engineUrl = process.env.ENGINE_URL ?? 'http://localhost:4000';

    const res = await fetch(
      `${engineUrl}/internal/sessions/${sessionId}/psychologist/reanalyze`,
      {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify({ projectId }),
      },
    );

    if (res.status === 503) {
      throw new PsychologistDisabledError();
    }

    if (!res.ok) {
      throw new Error(
        `Falha no comando ao engine (psychologist/reanalyze): ${res.status} ${await res.text()}`,
      );
    }
  }

  /**
   * Leitura pura (RN-454) — sem `postCommand` porque é GET e a única deste
   * client que devolve corpo em toda resposta de sucesso (sem `sessionId`/
   * `projectId` de segmento de URL: a flag é GLOBAL).
   */
  async getPsychologistStatus(): Promise<{ enabled: boolean }> {
    const engineUrl = process.env.ENGINE_URL ?? 'http://localhost:4000';

    const res = await fetch(`${engineUrl}/internal/psychologist/status`, {
      method: 'GET',
      headers: this.buildHeaders(),
    });

    if (!res.ok) {
      throw new Error(
        `Falha no comando ao engine (psychologist/status): ${res.status} ${await res.text()}`,
      );
    }

    const corpo = (await res.json()) as { enabled: boolean };
    return { enabled: corpo.enabled };
  }

  /**
   * Não usa `postCommand`: precisa distinguir o 503 ("Anamnese desativada
   * globalmente", RN — ver `AnamneseDisabledError`) de qualquer outra falha
   * de transporte, e `postCommand` colapsa todo `!res.ok` num `Error`
   * genérico que perde o status.
   */
  async runAnamnese(projectId: string): Promise<void> {
    projectId = garantirSegmentoDeUrlInterna(projectId, 'projectId');
    const engineUrl = process.env.ENGINE_URL ?? 'http://localhost:4000';

    const res = await fetch(
      `${engineUrl}/internal/projects/${projectId}/anamnese/run`,
      {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify({}),
      },
    );

    if (res.status === 503) {
      throw new AnamneseDisabledError();
    }

    if (!res.ok) {
      throw new Error(
        `Falha no comando ao engine (anamnese/run): ${res.status} ${await res.text()}`,
      );
    }
  }

  async invalidateInstructions(
    projectId: string,
    agent: string,
  ): Promise<void> {
    await this.postCommand(
      `/internal/projects/${projectId}/agents/${agent}/instructions/invalidate`,
      {},
      [
        ['projectId', projectId],
        ['agent', agent],
      ],
    );
  }

  /**
   * Diferente do resto deste client, não usa `postCommand`: precisa do
   * CORPO da resposta (o ticket bruto só existe aqui, uma vez — o engine
   * grava só o hash), e `postCommand` descarta o corpo em sucesso.
   */
  async requestRunnerTicket(
    projectId: string,
    userId: string,
    kind: 'runner' | 'terminal',
  ): Promise<{ ticket: string; expiresAt: Date }> {
    projectId = garantirSegmentoDeUrlInterna(projectId, 'projectId');
    const engineUrl = process.env.ENGINE_URL ?? 'http://localhost:4000';

    const res = await fetch(
      `${engineUrl}/internal/projects/${projectId}/runner-tickets`,
      {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify({ userId, kind }),
      },
    );

    if (!res.ok) {
      throw new Error(
        `Falha ao pedir ticket de runner ao engine: ${res.status} ${await res.text()}`,
      );
    }

    const corpo = (await res.json()) as { ticket: string; expiresAt: string };
    return { ticket: corpo.ticket, expiresAt: new Date(corpo.expiresAt) };
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
    await this.postCommand(
      `/internal/sessions/${sessionId}/execution/start`,
      {
        projectId,
        modules,
        taskBudgetMicros,
        maxGateCorrections,
        impl,
        maxConsecutiveBlocked,
      },
      [['sessionId', sessionId]],
    );
  }

  async acceptParallelization(
    projectId: string,
    sessionId: string,
    module: string,
  ): Promise<void> {
    await this.postCommand(
      `/internal/sessions/${sessionId}/execution/parallelize`,
      { projectId, module },
      [['sessionId', sessionId]],
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
      [
        ['sessionId', sessionId],
        ['agentId', agentId],
      ],
    );
  }

  async reviseStory(
    projectId: string,
    sessionId: string,
    storyId: string,
    title: string,
    reason: string,
  ): Promise<void> {
    await this.postCommand(
      `/internal/sessions/${sessionId}/agent/revise`,
      { projectId, storyId, title, reason },
      [['sessionId', sessionId]],
    );
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
   * `container_start` num projeto `mounted`/`runner` (ADR 0137) — pede ao
   * engine para repassar ao runner conectado via canal (`container_start`/
   * `container_start_result`, mesmo par de `exec`/`exec_result`). A resposta
   * do engine é SEMPRE 200: `sucesso: false` com `motivoCodigo` distingue
   * "sem runner"/"timeout" (`RunnerNaoConectadoError`) de "o runner tentou e
   * recusou" (`RunnerRecusouContainerError`) — nunca um status HTTP de erro
   * pra essas duas causas, o mesmo raciocínio do broker.
   */
  async startContainerViaRunner(
    projectId: string,
    spec: EspecificacaoDeContainerParaRunner,
  ): Promise<ContainerIniciadoViaRunner> {
    projectId = garantirSegmentoDeUrlInterna(projectId, 'projectId');
    const engineUrl = process.env.ENGINE_URL ?? 'http://localhost:4000';

    const res = await fetch(
      `${engineUrl}/internal/projects/${projectId}/containers/start`,
      {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify({ spec }),
      },
    );

    if (!res.ok) {
      throw new Error(
        `Falha ao pedir ao engine para subir o container via runner: ${res.status} ${await res.text()}`,
      );
    }

    const corpo = (await res.json()) as RespostaDeContainerViaRunner;
    lancarSeFalhou(corpo, 'subir');

    return {
      containerId: corpo.containerId ?? '',
      nome: corpo.nome ?? '',
      jaEstavaDePe: corpo.jaEstavaDePe ?? false,
    };
  }

  /** Espelho de `startContainerViaRunner` para `container_stop`. */
  async stopContainerViaRunner(
    projectId: string,
    workspaceDirName: string,
  ): Promise<void> {
    await this.pedirOperacaoDeContainerAoRunner(
      projectId,
      'stop',
      workspaceDirName,
    );
  }

  /** Espelho de `startContainerViaRunner` para `container_remove`. */
  async removeContainerViaRunner(
    projectId: string,
    workspaceDirName: string,
  ): Promise<void> {
    await this.pedirOperacaoDeContainerAoRunner(
      projectId,
      'remove',
      workspaceDirName,
    );
  }

  private async pedirOperacaoDeContainerAoRunner(
    projectId: string,
    operacao: 'stop' | 'remove',
    workspaceDirName: string,
  ): Promise<void> {
    projectId = garantirSegmentoDeUrlInterna(projectId, 'projectId');
    const engineUrl = process.env.ENGINE_URL ?? 'http://localhost:4000';

    const res = await fetch(
      `${engineUrl}/internal/projects/${projectId}/containers/${operacao}`,
      {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify({ workspaceDirName }),
      },
    );

    if (!res.ok) {
      throw new Error(
        `Falha ao pedir ao engine para ${operacao === 'stop' ? 'parar' : 'remover'} o container via runner: ${res.status} ${await res.text()}`,
      );
    }

    const corpo = (await res.json()) as RespostaDeContainerViaRunner;
    lancarSeFalhou(corpo, operacao === 'stop' ? 'parar' : 'remover');
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
    // (nome, valor) de cada id que o chamador já interpolou em `path`
    // (RN-128) — validados aqui, num lugar só, ANTES de montar a
    // requisição, para que esquecer de listar um id não compile em silêncio
    // como "sem checagem nenhuma" (revisão de PR ainda vê a lista vazia).
    segmentosDeUrl: ReadonlyArray<readonly [string, string]> = [],
  ): Promise<void> {
    for (const [nome, valor] of segmentosDeUrl) {
      garantirSegmentoDeUrlInterna(valor, nome);
    }

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
