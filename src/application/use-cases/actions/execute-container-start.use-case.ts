import { Injectable } from '@nestjs/common';
import { UnitOfWork } from '../../ports/unit-of-work.port';
import { ProposedActionRepository } from '../../ports/proposed-action-repository.port';
import { OutboxRepository } from '../../ports/outbox-repository.port';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';
import { GetModuleRoutingUseCase } from '../architecture/get-module-routing.use-case';
import { DecidirImagemDoProjetoUseCase } from '../containers/decidir-imagem-do-projeto.use-case';
import { ObterCicloDeVidaDoContainerUseCase } from '../containers/obter-ciclo-de-vida-do-container.use-case';
import { RegistrarTransicaoDeContainerUseCase } from '../containers/registrar-transicao-de-container.use-case';
import { ObterSpecDeContainerUseCase } from '../containers/obter-spec-de-container.use-case';
import { ProjectRepository } from '../../ports/project-repository.port';
import {
  BrokerIndisponivelError,
  BrokerRecusouError,
  ContainerBrokerPort,
  type ContainerIniciadoPeloBroker,
} from '../../ports/container-broker.port';
import {
  ApiToEngineClient,
  RunnerNaoConectadoError,
  RunnerRecusouContainerError,
  type ContainerIniciadoViaRunner,
} from '../../ports/api-to-engine-client.port';
import type {
  PosturaDeRede,
  RecursosDoContainer,
} from '../../../domain/containers/project-container';
import type { ContainerStartExecutionResult } from '../../../domain/containers/container-start-execution-result';
import type { ProposedAction } from '../../../domain/actions/proposed-action.entity';

interface ContainerStartPayload {
  imagem: string;
  network: PosturaDeRede;
  resources: RecursosDoContainer;
  rationale: string;
}

/**
 * Executa uma ação `container_start` aprovada (ADR 0130/0133): a Infra
 * elegeu uma das imagens candidatadas pelo Arquiteto
 * (`route_modules_to_infra`) e este caso de uso (a) EMITE a nova versão de
 * `artifact.project_image` com essa eleição, reusando
 * `DecidirImagemDoProjetoUseCase` — é isso que faz a eleição da Infra ter
 * efeito real sobre o que o broker compõe, já que `GET
 * .../container-spec` lê `artifact.project_image`, nunca
 * `artifact.module_routing` — e (b) pede ao broker para subir o container
 * de verdade, registrando a transição de ciclo de vida correspondente.
 *
 * Mirror de `ExecuteInfraPrUseCase`: mesmo shell try/catch, mesmo par
 * record()/fail() gravando `updateExecutionResult` + evento de sessão +
 * outbox `proposed_action.executed`/`.failed`.
 *
 * ## Dois caminhos, a partir do `executionMode` do projeto (ADR 0137, RN-501)
 *
 * `container_start` não distingue modo na hora de ser PROPOSTA
 * (`GetInfraContextUseCase`/`propose_container_start` não restringem por
 * `executionMode` — lacuna aceita e declarada desde a RN-494) nem na hora de
 * ser APROVADA (`decide.ts` também não olha modo). A ramificação é só AQUI,
 * na execução, e ela é por DESTINO, não por modo:
 *
 *   - `container` E `mounted` — o BROKER. Desde o ADR 0141 a pasta de um
 *     projeto montado mora sob UMA base que este servidor monta por
 *     identidade, então o daemon a alcança; a spec diz contra qual das duas
 *     raízes do broker o segmento vale (`localizacao`, RN-501) e mais nada
 *     muda. Os dois ELEGEM a imagem candidata do roteamento do Arquiteto.
 *   - `runner` — o ENGINE repassando ao RUNNER conectado, via canal Phoenix
 *     (`container_start`/`container_start_result`, mesmo par de
 *     `exec`/`exec_result`). NÃO elege nada: a imagem que sobe é a que já
 *     estiver DECIDIDA, via `ObterSpecDeContainerUseCase` — o mesmo caso de
 *     uso que `GET .../container-spec` expõe ao broker, reusado direto, sem
 *     HTTP, porque api e este caso de uso rodam no mesmo processo. "Sem
 *     runner conectado" (`RunnerNaoConectadoError`) e "o runner recusou"
 *     (`RunnerRecusouContainerError`) são FALHAS NORMAIS — nunca lançam para
 *     fora, viram `failed` nomeado, mesma disciplina de
 *     `BrokerIndisponivelError`/`BrokerRecusouError` no caminho do broker.
 *
 * ## Por que `mounted` ELEGE, e não lê a imagem vigente como o runner faz
 *
 * Não é simetria estética: é o único desenho que funciona. O broker COMPÕE a
 * partir de `artifact.project_image`, indo buscá-lo na api — ele nunca recebe
 * a imagem no corpo da chamada, que é o invariante inteiro do ADR 0130. Uma
 * eleição da Infra que não fosse GRAVADA naquele artefato seria, portanto,
 * inerte: o container subiria com a imagem que o Arquiteto tinha decidido, o
 * payload aprovado pelo humano diria outra coisa, e nada no registro
 * denunciaria a diferença. O caminho do runner pode ler o vigente justamente
 * porque a api LHE MANDA os campos da spec pelo canal — lá o artefato não é a
 * fonte que o outro lado consulta.
 */
@Injectable()
export class ExecuteContainerStartUseCase {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly proposedActions: ProposedActionRepository,
    private readonly appendSessionEvent: AppendSessionEventUseCase,
    private readonly outbox: OutboxRepository,
    private readonly getModuleRouting: GetModuleRoutingUseCase,
    private readonly decidirImagem: DecidirImagemDoProjetoUseCase,
    private readonly obterCicloDeVida: ObterCicloDeVidaDoContainerUseCase,
    private readonly registrarTransicao: RegistrarTransicaoDeContainerUseCase,
    private readonly brokerPort: ContainerBrokerPort,
    private readonly projects: ProjectRepository,
    private readonly obterSpec: ObterSpecDeContainerUseCase,
    private readonly apiToEngineClient: ApiToEngineClient,
  ) {}

  async execute(
    projectId: string,
    sessionId: string,
    action: ProposedAction,
  ): Promise<ProposedAction> {
    const project = await this.projects.findById(projectId);
    if (!project) {
      return this.fail(
        projectId,
        sessionId,
        action.id,
        'Projeto não encontrado.',
      );
    }

    if (project.executionMode === 'runner') {
      return this.executeViaRunner(projectId, sessionId, action);
    }

    const payload = action.payload as ContainerStartPayload;

    // A imagem eleita precisa ser uma das candidatas do roteamento VIGENTE
    // do Arquiteto — a Infra elege, nunca inventa. Isto acontece ANTES de
    // tocar em `artifact.project_image`: nunca gravar uma decisão para uma
    // imagem não validada.
    const roteamento = await this.getModuleRouting.execute(projectId);
    const candidatas = roteamento.roteamento.map((r) => r.imagemCandidata);
    if (!candidatas.includes(payload.imagem)) {
      return this.fail(
        projectId,
        sessionId,
        action.id,
        `Imagem "${payload.imagem}" não é uma das candidatas do roteamento ` +
          `vigente do Arquiteto (${candidatas.join(', ') || 'nenhuma'}) — a ` +
          'Infra elege entre as candidatas, nunca inventa uma imagem.',
      );
    }

    try {
      const decidida = await this.decidirImagem.execute(
        projectId,
        sessionId,
        {
          image: payload.imagem,
          rationale: `Eleita entre as candidatas do roteamento do Arquiteto: ${payload.rationale}`,
          network: payload.network,
          resources: payload.resources,
        },
        'infra-lead',
      );

      let iniciado: ContainerIniciadoPeloBroker;
      try {
        iniciado = await this.brokerPort.start(projectId);
      } catch (erro) {
        if (
          erro instanceof BrokerRecusouError ||
          erro instanceof BrokerIndisponivelError
        ) {
          return this.fail(
            projectId,
            sessionId,
            action.id,
            erro.message,
            decidida.decisao.image,
            decidida.version,
          );
        }
        throw erro;
      }

      // A dança provisioning -> running, e por que `stopped` pula direto
      // para `running`:
      //
      // A máquina de estados (`container-lifecycle.ts`) exige que a
      // PRIMEIRA linha de um projeto nasça em `provisioning` — é essa
      // transição que lê a decisão de imagem vigente (a que acabamos de
      // gravar acima) e CONGELA `imageVersion`/`resources` na linha nova.
      // Sem linha ainda, ou com a linha marcada `failed`/`removed` (as duas
      // sem container de pé), replicamos esse ciclo completo:
      // `provisioning` (nasce/renasce a linha) e só então `running` (o
      // broker confirmou que subiu).
      //
      // `stopped` já tem linha viva com `imageVersion` gravado — reprovisionar
      // reemitiria uma imagem que pode já estar desatualizada em relação à que
      // acabamos de decidir, e a máquina de estados nem permite `stopped ->
      // provisioning` (só `stopped -> running/failed/removed`). Por isso vai
      // direto para `running`: é o broker reconectando a um container que a
      // tabela já sabia que existia, não provisionando um novo.
      //
      // `provisioning`/`running` já vivos: o broker é idempotente
      // (`jaEstavaDePe`) — só falta completar a transição pendente
      // (`provisioning -> running`) ou não fazer nada (já `running`).
      await this.subirCicloDeVida(projectId, iniciado.containerId);

      return this.record(projectId, sessionId, action.id, 'executed', {
        motivo: null,
        imagem: decidida.decisao.image,
        version: decidida.version,
        network: decidida.decisao.network,
        resources: decidida.decisao.resources,
        containerId: iniciado.containerId,
        jaEstavaDePe: iniciado.jaEstavaDePe,
      });
    } catch (error) {
      return this.fail(
        projectId,
        sessionId,
        action.id,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  /**
   * `runner` (ADR 0137) — ver o docblock da classe. Não elege candidata
   * nenhuma: a imagem que sobe é a que `ObterSpecDeContainerUseCase` já
   * devolve como VIGENTE (o mesmo caso de uso que compõe `GET
   * .../container-spec` para o broker — chamado direto, sem HTTP, porque os
   * dois rodam no mesmo processo da api).
   *
   * `mounted` deixou de passar por aqui na RN-501: a pasta dele virou
   * alcançável pelo daemon do servidor (ADR 0141), e exigir um runner
   * conectado para um projeto cujo código o servidor enxerga era pedir uma
   * peça que não tem mais função.
   */
  private async executeViaRunner(
    projectId: string,
    sessionId: string,
    action: ProposedAction,
  ): Promise<ProposedAction> {
    try {
      const spec = await this.obterSpec.execute(projectId);
      if (!spec.imagem) {
        return this.fail(
          projectId,
          sessionId,
          action.id,
          'Ainda não há imagem decidida para este projeto (RN-105) — nada para subir.',
        );
      }

      let iniciado: ContainerIniciadoViaRunner;
      try {
        iniciado = await this.apiToEngineClient.startContainerViaRunner(
          projectId,
          {
            workspaceDirName: spec.workspaceDirName,
            projectSlug: spec.projectSlug,
            workspaceId: spec.workspaceId,
            imagem: spec.imagem.image,
            imagemVersao: spec.imagemVersao,
            rede: spec.imagem.network,
            cpus: spec.imagem.resources.cpus,
            memoriaMb: spec.imagem.resources.memoryMb,
            pidsLimit: spec.imagem.resources.pidsLimit,
          },
        );
      } catch (erro) {
        if (
          erro instanceof RunnerNaoConectadoError ||
          erro instanceof RunnerRecusouContainerError
        ) {
          return this.fail(
            projectId,
            sessionId,
            action.id,
            erro.message,
            spec.imagem.image,
            spec.imagemVersao,
          );
        }
        throw erro;
      }

      await this.subirCicloDeVida(projectId, iniciado.containerId);

      return this.record(projectId, sessionId, action.id, 'executed', {
        motivo: null,
        imagem: spec.imagem.image,
        version: spec.imagemVersao,
        network: spec.imagem.network,
        resources: spec.imagem.resources,
        containerId: iniciado.containerId,
        jaEstavaDePe: iniciado.jaEstavaDePe,
      });
    } catch (error) {
      return this.fail(
        projectId,
        sessionId,
        action.id,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  /**
   * A dança provisioning -> running, e por que `stopped` pula direto para
   * `running`:
   *
   * A máquina de estados (`container-lifecycle.ts`) exige que a PRIMEIRA
   * linha de um projeto nasça em `provisioning` — é essa transição que lê a
   * decisão de imagem vigente e CONGELA `imageVersion`/`resources` na linha
   * nova. Sem linha ainda, ou com a linha marcada `failed`/`removed` (as
   * duas sem container de pé), replicamos esse ciclo completo:
   * `provisioning` (nasce/renasce a linha) e só então `running` (o
   * broker/runner confirmou que subiu).
   *
   * `stopped` já tem linha viva com `imageVersion` gravado — reprovisionar
   * reemitiria uma imagem que pode já estar desatualizada, e a máquina de
   * estados nem permite `stopped -> provisioning` (só `stopped ->
   * running/failed/removed`). Por isso vai direto para `running`.
   *
   * `provisioning`/`running` já vivos: quem subiu é idempotente — só falta
   * completar a transição pendente (`provisioning -> running`) ou não fazer
   * nada (já `running`).
   */
  private async subirCicloDeVida(
    projectId: string,
    containerId: string,
  ): Promise<void> {
    const atual = await this.obterCicloDeVida.execute(projectId);
    if (!atual || atual.status === 'failed' || atual.status === 'removed') {
      await this.registrarTransicao.execute(projectId, 'provisioning');
    }
    if (!atual || atual.status !== 'running') {
      await this.registrarTransicao.execute(projectId, 'running', {
        containerId,
      });
    }
    // atual.status === 'running': nada a transicionar, já está de pé.
  }

  private fail(
    projectId: string,
    sessionId: string,
    actionId: string,
    motivo: string,
    imagem = '',
    version = 0,
  ) {
    return this.record(projectId, sessionId, actionId, 'failed', {
      motivo,
      imagem,
      version,
      network: null,
      resources: null,
      containerId: null,
      jaEstavaDePe: false,
    });
  }

  private record(
    projectId: string,
    sessionId: string,
    actionId: string,
    status: 'executed' | 'failed',
    executionResult: ContainerStartExecutionResult,
  ) {
    return this.unitOfWork.runInTransaction(async () => {
      const updated = await this.proposedActions.updateExecutionResult(
        actionId,
        { status, executionResult },
      );

      await this.appendSessionEvent.execute(projectId, sessionId, {
        type:
          status === 'executed'
            ? 'container.started'
            : 'container.start_failed',
        actor: { kind: 'system', id: 'action-executor' },
        payload: {
          actionId,
          imagem: executionResult.imagem,
          containerId: executionResult.containerId,
          motivo: executionResult.motivo,
        },
      });

      await this.outbox.append({
        aggregateType: 'proposed_action',
        aggregateId: actionId,
        eventType:
          status === 'executed'
            ? 'proposed_action.executed'
            : 'proposed_action.failed',
        payload: { actionId },
      });

      return updated;
    });
  }
}
