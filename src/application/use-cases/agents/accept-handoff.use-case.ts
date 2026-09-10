import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Actor } from '../../../domain/sessions/session-event.entity';
import { HandoffRepository } from '../../ports/handoff-repository.port';
import { AgentAutonomyRepository } from '../../ports/agent-autonomy-repository.port';
import { ProjectRepository } from '../../ports/project-repository.port';
import { ProvisionedRepositoryRepository } from '../../ports/provisioned-repository-repository.port';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';
import { ProvisionRepositoryUseCase } from '../git/provision-repository.use-case';
import { ActivateAgentUseCase } from './activate-agent.use-case';

// InfraAgent NUNCA aplica nada em ambiente, só propõe (Fase 4a) — a PR de
// infra fica pending por padrão em decide() (open_infra_pr: 'maintainer'),
// mas essa autonomia seedada aqui deixa a PROPOSTA auto-aprovada pro
// InfraAgent especificamente (auto-aprovar a proposta de uma PR é seguro; a
// PR de verdade ainda precisa ser mergeada manualmente no provider). O
// terminal genérico fica negado por policy — defesa em profundidade além
// da estrutural (o tool registry do InfraAgent nunca inclui `Terminal`).
const INFRA_AUTONOMY_SEEDS: ReadonlyArray<{
  actionType: string;
  policy: 'auto_approve' | 'deny';
}> = [
  { actionType: 'open_infra_pr', policy: 'auto_approve' },
  { actionType: 'terminal', policy: 'deny' },
];

// Quem recebe o handoff que faz o repositório nascer (RN-522). O gatilho é o
// Dev Lead e não a ativação da execução porque são instantes DISTINTOS, nesta
// ordem: o Arquiteto entrega, e só depois os dev agents começam. É no primeiro
// que "o desenvolvimento começou" passa a ser verdade.
const AGENTE_QUE_DISPARA_PROVISIONAMENTO = 'dev-lead';

// `local` é o único provider que não pede credencial nenhuma
// (`provision-repository.use-case.ts`, o `if (providerName !== 'local')`), e é
// o que torna o provisionamento AUTOMÁTICO possível: nenhum humano escolheu
// onde hospedar no meio do aceite, então não há credencial a resolver.
// Publicar num provider remoto continua sendo caminho separado (adoção, ou
// conversão em Configurações).
const PROVIDER_DO_PROVISIONAMENTO_ADIADO = 'local' as const;

const ATOR_DO_PROVISIONAMENTO: Actor = {
  kind: 'system',
  id: 'handoff-provision',
};

/**
 * O usuário aceita um handoff oferecido — transiciona offered→accepted, grava
 * `handoff.accepted` e ATIVA o agente destino (PO). A regra de ativação
 * (agent-activation) exige um handoff accepted endereçado ao agente — que
 * passa a existir exatamente por esta aceitação.
 *
 * Desde a RN-522, o aceite endereçado ao **Dev Lead** também provisiona o
 * repositório git do projeto: criar projeto deixou de provisionar (RN-541), e
 * este é o momento em que o desenvolvimento começa.
 */
@Injectable()
export class AcceptHandoffUseCase {
  constructor(
    private readonly handoffs: HandoffRepository,
    private readonly agentAutonomy: AgentAutonomyRepository,
    private readonly appendEvent: AppendSessionEventUseCase,
    private readonly activateAgent: ActivateAgentUseCase,
    private readonly projects: ProjectRepository,
    private readonly repositories: ProvisionedRepositoryRepository,
    private readonly provisionRepository: ProvisionRepositoryUseCase,
  ) {}

  async execute(
    projectId: string,
    sessionId: string,
    handoffId: string,
    userId: string,
  ) {
    const handoff = await this.handoffs.findById(handoffId);
    if (!handoff || handoff.sessionId !== sessionId) {
      throw new NotFoundException('Handoff não encontrado');
    }
    if (handoff.status !== 'offered') {
      throw new BadRequestException(
        `Handoff não está "offered" (está "${handoff.status}")`,
      );
    }

    const accepted = await this.handoffs.updateStatus(handoffId, 'accepted');

    await this.appendEvent.execute(projectId, sessionId, {
      type: 'handoff.accepted',
      actor: { kind: 'user', id: userId },
      payload: { handoffId, toAgent: handoff.toAgent },
    });

    if (handoff.toAgent === 'infra') {
      for (const seed of INFRA_AUTONOMY_SEEDS) {
        await this.agentAutonomy.upsert(
          projectId,
          'infra',
          seed.actionType,
          seed.policy,
        );
      }
    }

    if (handoff.toAgent === AGENTE_QUE_DISPARA_PROVISIONAMENTO) {
      await this.provisionarRepositorio(projectId, sessionId, userId);
    }

    // Agora a regra de ativação passa (handoff accepted p/ toAgent).
    await this.activateAgent.execute(
      projectId,
      sessionId,
      handoff.toAgent,
      userId,
    );

    return accepted;
  }

  /**
   * O repositório do projeto nasce aqui (RN-522).
   *
   * POR QUE A FALHA NÃO PODE SUBIR. Este caso de uso não tem transação: quando
   * este método roda, `updateStatus('accepted')` e o evento `handoff.accepted`
   * já estão COMMITADOS. Um throw daqui devolveria 500 ao usuário sobre um
   * handoff que, no banco, foi aceito — e ainda impediria o `activateAgent`
   * logo abaixo, deixando o Dev Lead sem acordar por causa de uma falha de
   * git. Então a falha vira EVENTO nomeado e o aceite segue: o desfecho fica
   * no event log, com origem, em vez de virar uma resposta vazia (a régua de
   * `agent.error`, RN-059).
   *
   * O que NÃO é falha: projeto que ADOTOU um repositório. `ProvisionRepository`
   * recusa esse caso com `ConflictException` de propósito (bootstrap de repo de
   * terceiro só roda por aprovação de plano, RN-045) — mas o projeto TEM
   * repositório, então não há o que provisionar, e registrar isso como falha
   * mentiria. Repositório `created` que já existe cai no caso de uso normal, que
   * é idempotente por desenho: rodar de novo converge com todos os passos
   * reportando satisfeito.
   */
  private async provisionarRepositorio(
    projectId: string,
    sessionId: string,
    userId: string,
  ): Promise<void> {
    try {
      const existente = await this.repositories.findByProjectId(projectId);
      if (existente?.origin === 'adopted') return;

      const project = await this.projects.findById(projectId);
      if (!project) {
        throw new Error(
          `projeto ${projectId} não encontrado ao provisionar no handoff`,
        );
      }

      await this.provisionRepository.execute(projectId, userId, {
        provider: PROVIDER_DO_PROVISIONAMENTO_ADIADO,
        name: project.slug,
        visibility: 'private',
      });
    } catch (erro) {
      const mensagem = erro instanceof Error ? erro.message : String(erro);
      await this.appendEvent.execute(projectId, sessionId, {
        type: 'repository.provision_failed',
        actor: ATOR_DO_PROVISIONAMENTO,
        payload: { origem: 'infra', error: mensagem },
      });
    }
  }
}
