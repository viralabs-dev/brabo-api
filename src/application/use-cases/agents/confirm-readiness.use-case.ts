import { Injectable } from '@nestjs/common';
import { ApiToEngineClient } from '../../ports/api-to-engine-client.port';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';
import { MARCA_DO_ESTOU_PRONTO } from '../../../domain/sessions/estou-pronto';

/**
 * Confirmação de prontidão é AÇÃO DO USUÁRIO (botão), não inferência do
 * modelo (CLAUDE.md 3b.3): o Criativo sugere, o usuário decide. Grava
 * `readiness.confirmed` e sinaliza o engine, que só então instrui o Criativo
 * a consolidar as regras num `product_brief` e oferecer o handoff ao PO.
 *
 * Desde o ADR 0185 o clique é "Estou pronto — a necessidade está validada" e
 * fecha os DOIS gates (RN-657): depois que o engine ACEITA o turno, grava
 * também `necessity.validated`, com a mesma pessoa como ator e o
 * `product_brief` ainda por vir (`productBriefId: null` — ele nasce do turno
 * que este clique dispara). A ordem importa: recusa do engine (409 turno em
 * curso, 422 sem regra de negócio) sobe ANTES, e aí a necessidade NÃO fica
 * validada — não há brief nenhum a caminho.
 *
 * O `readiness.confirmed` leva a marca `MARCA_DO_ESTOU_PRONTO`, e é por ela
 * que o handoff Criativo→PO que o turno oferecer é aceito em nome desta
 * pessoa (RN-658, `AceiteImplicitoDoPoUseCase`). Evento antigo, sem a marca,
 * não aceita nada.
 */
@Injectable()
export class ConfirmReadinessUseCase {
  constructor(
    private readonly engineClient: ApiToEngineClient,
    private readonly appendEvent: AppendSessionEventUseCase,
  ) {}

  async execute(projectId: string, sessionId: string, userId: string) {
    const prontidao = await this.appendEvent.execute(projectId, sessionId, {
      type: 'readiness.confirmed',
      actor: { kind: 'user', id: userId },
      payload: { ...MARCA_DO_ESTOU_PRONTO },
    });

    await this.engineClient.confirmReadiness(projectId, sessionId);

    await this.appendEvent.execute(projectId, sessionId, {
      type: 'necessity.validated',
      actor: { kind: 'user', id: userId },
      payload: {
        productBriefId: null,
        via: 'readiness.confirmed',
        readinessEventId: prontidao.id,
      },
    });

    return { ok: true as const };
  }
}
