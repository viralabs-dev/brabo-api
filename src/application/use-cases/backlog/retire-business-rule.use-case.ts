import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  StoryRepository,
  TaskRepository,
} from '../../ports/backlog-repository.port';
import { SessionEventRepository } from '../../ports/session-event-repository.port';
import { UnitOfWork } from '../../ports/unit-of-work.port';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';
import { PerguntasEmAbertoUseCase } from './perguntas-em-aberto.use-case';
import { STATUS_DE_TAREFA_EM_EXECUCAO } from '../../../domain/backlog/correcao-de-historia';
import {
  EVENTO_REGRA_RETIRADA,
  idsDeRegrasRetiradas,
} from './regras-retiradas';

/** RN-1018: só estes papéis retiram regra (decisão do dono, 06/11/2026). */
export const PAPEIS_QUE_RETIRAM_REGRA: readonly string[] = ['criativo', 'po'];

export interface RetireBusinessRuleInput {
  sessionId: string;
  agentRole: string;
  reason: string;
  replacedBy?: string;
  questionId?: string;
}

export interface RetiredBusinessRule {
  ruleId: string;
  replacedBy: string | null;
  questionId: string | null;
  /** Histórias cuja citação foi trocada (ou retirada) por causa desta retirada. */
  storyIds: string[];
}

/**
 * O agente RETIRA a regra de negócio obsoleta (RN-1018, ADR 0262). A regra é
 * evento imutável; retirar é gravar `artifact.business_rule_retired`, que todo
 * leitor que decide passa a respeitar. Sem cartão de aprovação: a régua é a da
 * RN-859 — cita a regra que substitui e/ou uma pergunta que o usuário já
 * respondeu.
 */
@Injectable()
export class RetireBusinessRuleUseCase {
  constructor(
    private readonly stories: StoryRepository,
    private readonly tasks: TaskRepository,
    private readonly sessionEvents: SessionEventRepository,
    private readonly appendEvent: AppendSessionEventUseCase,
    private readonly unitOfWork: UnitOfWork,
    private readonly perguntas: PerguntasEmAbertoUseCase,
  ) {}

  async execute(
    projectId: string,
    ruleId: string,
    input: RetireBusinessRuleInput,
  ): Promise<RetiredBusinessRule> {
    if (!PAPEIS_QUE_RETIRAM_REGRA.includes(input.agentRole)) {
      throw new ForbiddenException({
        message: `O papel "${input.agentRole}" não retira regra de negócio — só o Criativo e o PO.`,
        reason: 'papel_nao_retira_regra',
      });
    }
    if (!input.replacedBy && !input.questionId) {
      throw new BadRequestException({
        message:
          'Cite a regra que substitui (`replacedBy`) e/ou uma pergunta que o usuário já respondeu (`questionId`).',
        reason: 'retirada_sem_citacao',
      });
    }

    const retiradas = await idsDeRegrasRetiradas(this.sessionEvents, projectId);
    const regras = await this.sessionEvents.listByTypeForProject(
      projectId,
      'artifact.business_rule',
    );
    const ativas = new Set(
      regras.map((r) => r.id).filter((id) => !retiradas.has(id)),
    );
    if (!regras.some((r) => r.id === ruleId)) {
      throw new NotFoundException(
        `Regra "${ruleId}" não encontrada neste projeto`,
      );
    }
    if (retiradas.has(ruleId)) {
      throw new ConflictException({
        message: `A regra "${ruleId}" já foi retirada.`,
        reason: 'regra_ja_retirada',
      });
    }
    if (input.replacedBy) {
      if (input.replacedBy === ruleId || !ativas.has(input.replacedBy)) {
        throw new BadRequestException({
          message: `A substituta "${input.replacedBy}" precisa ser outra regra existente e não retirada.`,
          reason: 'substituta_invalida',
        });
      }
    }
    if (
      input.questionId &&
      !(await this.perguntas.foiRespondida(projectId, input.questionId))
    ) {
      throw new ConflictException({
        message: `A pergunta "${input.questionId}" não foi respondida pelo usuário.`,
        reason: 'pergunta_nao_respondida',
      });
    }

    const afetadas = (await this.stories.findByProject(projectId)).filter((s) =>
      s.businessRuleIds.includes(ruleId),
    );
    const tarefas = await this.tasks.findByStoryIds(afetadas.map((s) => s.id));
    for (const s of afetadas) {
      const emExecucao = tarefas.filter(
        (t) =>
          t.storyId === s.id && STATUS_DE_TAREFA_EM_EXECUCAO.includes(t.status),
      ).length;
      if (emExecucao > 0) {
        throw new ConflictException({
          message: `A história "${s.title}" cita a regra e tem ${emExecucao} tarefa(s) em execução. Espere a tarefa terminar.`,
          reason: 'historia_com_tarefa_em_execucao',
        });
      }
      const sobra = s.businessRuleIds.filter((id) => id !== ruleId);
      if (!input.replacedBy && sobra.length === 0) {
        throw new ConflictException({
          message: `A história "${s.title}" ficaria sem nenhuma regra. Cite a substituta em \`replacedBy\`.`,
          reason: 'historia_ficaria_sem_regra',
        });
      }
    }

    return this.unitOfWork.runInTransaction(async () => {
      for (const s of afetadas) {
        const sobra = s.businessRuleIds.filter((id) => id !== ruleId);
        const ids =
          input.replacedBy && !sobra.includes(input.replacedBy)
            ? [...sobra, input.replacedBy]
            : sobra;
        await this.stories.updateContent(s.id, {
          description: s.description,
          rf: s.rf,
          rnf: s.rnf,
          dod: s.dod,
          dor: s.dor,
          businessRuleIds: ids,
        });
      }
      const storyIds = afetadas.map((s) => s.id);
      await this.appendEvent.execute(projectId, input.sessionId, {
        type: EVENTO_REGRA_RETIRADA,
        actor: { kind: 'agent', id: input.agentRole },
        payload: {
          ruleId,
          reason: input.reason,
          storyIds,
          ...(input.replacedBy ? { replacedBy: input.replacedBy } : {}),
          ...(input.questionId ? { questionId: input.questionId } : {}),
        },
      });
      return {
        ruleId,
        replacedBy: input.replacedBy ?? null,
        questionId: input.questionId ?? null,
        storyIds,
      };
    });
  }
}
