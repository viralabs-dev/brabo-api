import { BadRequestException, Injectable } from '@nestjs/common';
import { ApiToEngineClient } from '../../ports/api-to-engine-client.port';
import { StoryRepository } from '../../ports/backlog-repository.port';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';
import { HandoffRepository } from '../../ports/handoff-repository.port';
import { CicloDeVidaDoHandoff } from './ciclo-de-vida-do-handoff.service';

/** Os dois destinos que a confirmação de arquitetura pronta alcança. */
const ALVOS_DA_CONFIRMACAO = ['infra', 'dev-lead'] as const;
type AlvoDaConfirmacao = (typeof ALVOS_DA_CONFIRMACAO)[number];

/** Por que um destino NÃO foi acionado de novo (ADR 0182, RN-635). */
export interface AlvoJaAtendido {
  toAgent: AlvoDaConfirmacao;
  motivo: 'oferta_pendente' | 'agente_ativo';
}

export interface ResultadoDaConfirmacaoDeArquitetura {
  ok: true;
  /**
   * `confirmado`: pelo menos um destino foi acionado. `ja_oferecido`: os dois
   * já tinham oferta pendente ou estavam ativos — nada foi gravado nem pedido
   * ao engine (o duplo clique, a segunda aba).
   */
  desfecho: 'confirmado' | 'ja_oferecido';
  jaAtendidos: AlvoJaAtendido[];
}

/**
 * O usuário confirma que a arquitetura está pronta (Fase 4a — fechamento):
 * mirror de ConfirmReadinessUseCase, mas endpoint DEDICADO (não reaproveita
 * o de readiness — agente e momento diferentes). Grava
 * `architecture.readiness_confirmed` e sinaliza o engine, que só então
 * instrui o Arquiteto a oferecer o handoff ao InfraAgent.
 *
 * RN-160 revalidada aqui (auditoria fluxo.yml x código, item B6): a UI
 * (`SessionPage.tsx`, `hasPromotedStory`) já desabilita o botão sem
 * história promovida, mas uma chamada HTTP direta ignorava a regra por
 * completo — quem tem autoridade final é o backend, não o cliente.
 */
@Injectable()
export class OfferInfraHandoffUseCase {
  constructor(
    private readonly engineClient: ApiToEngineClient,
    private readonly appendEvent: AppendSessionEventUseCase,
    private readonly storyRepository: StoryRepository,
    private readonly handoffs: HandoffRepository,
    private readonly ciclo: CicloDeVidaDoHandoff,
  ) {}

  async execute(
    projectId: string,
    sessionId: string,
    userId: string,
  ): Promise<ResultadoDaConfirmacaoDeArquitetura> {
    const stories = await this.storyRepository.findByProject(projectId);
    const haHistoriaPromovida = stories.some(
      (story) => story.status !== 'draft',
    );
    if (!haHistoriaPromovida) {
      throw new BadRequestException(
        'Confirme com pelo menos uma história promovida do backlog (RN-160): nenhuma história deste projeto saiu de "draft".',
      );
    }

    const jaAtendidos: AlvoJaAtendido[] = [];
    for (const toAgent of ALVOS_DA_CONFIRMACAO) {
      const motivo = await this.jaAtendido(projectId, toAgent);
      if (motivo) jaAtendidos.push({ toAgent, motivo });
    }
    const atendido = (alvo: AlvoDaConfirmacao) =>
      jaAtendidos.some((a) => a.toAgent === alvo);
    if (jaAtendidos.length === ALVOS_DA_CONFIRMACAO.length) {
      return { ok: true, desfecho: 'ja_oferecido', jaAtendidos };
    }

    await this.appendEvent.execute(projectId, sessionId, {
      type: 'architecture.readiness_confirmed',
      actor: { kind: 'user', id: userId },
      payload: {},
    });

    if (!atendido('infra')) {
      await this.engineClient.offerInfraHandoff(projectId, sessionId);
    }

    // FASE 14d (ADR 0053): a MESMA confirmação também entrega ao Dev Lead. A
    // cadeia vira Arquiteto → Dev Lead → execução, e antes disto não havia
    // ninguém entre o fim da arquitetura e o botão de ativar.
    //
    // Chamadas SEPARADAS, e a de dev vem depois: são duas áreas com desfechos
    // independentes, e uma falha do Dev Lead não pode desfazer o handoff de
    // Infra que já foi aceito — o event log não retrata.
    if (!atendido('dev-lead')) {
      await this.engineClient.offerDevHandoff(projectId, sessionId);
    }

    return { ok: true, desfecho: 'confirmado', jaAtendidos };
  }

  private async jaAtendido(
    projectId: string,
    toAgent: AlvoDaConfirmacao,
  ): Promise<AlvoJaAtendido['motivo'] | null> {
    const pendentes = await this.handoffs.findOfferedToAgentInProject(
      projectId,
      toAgent,
    );
    if (pendentes.length > 0) return 'oferta_pendente';
    if (await this.ciclo.sessaoOndeEstaAtivo(projectId, toAgent)) {
      return 'agente_ativo';
    }
    return null;
  }
}
