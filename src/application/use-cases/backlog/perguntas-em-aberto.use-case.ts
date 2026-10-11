import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SessionEventRepository } from '../../ports/session-event-repository.port';
import { SessionRepository } from '../../ports/session-repository.port';
import { UnitOfWork } from '../../ports/unit-of-work.port';
import { ApiToEngineClient } from '../../ports/api-to-engine-client.port';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';
import type { SessionEvent } from '../../../domain/sessions/session-event.entity';
import {
  EVENTO_PERGUNTA_EM_ABERTO,
  EVENTO_PERGUNTA_RESPONDIDA,
  descreverAfeta,
  respostaEscolhida,
  type AfetaDaPergunta,
  type StatusDaPergunta,
} from '../../../domain/open-questions/pergunta-em-aberto';

/** Teto da leitura (RN-180): a lista diz o total, nunca afirma sobre o que não leu. */
export const TETO_DA_LISTA_DE_PERGUNTAS = 50;

export interface PerguntaEmAberto {
  questionId: string;
  eventId: string;
  sessionId: string;
  pergunta: string;
  sugestao: string | null;
  afeta: AfetaDaPergunta;
  autor: string;
  criadaEm: string;
  status: StatusDaPergunta;
  /** Quem pode responder: o autor da sessão de origem (RN-858). */
  autorDaSessao: string | null;
  resposta: {
    texto: string;
    aceitouSugestao: boolean;
    decisionEventId: string;
    respondidaPor: string;
    respondidaEm: string;
  } | null;
}

export interface ListaDePerguntas {
  itens: PerguntaEmAberto[];
  total: number;
}

export type FiltroDeStatus = 'open' | 'answered' | 'all';

/**
 * A pergunta em aberto de agente (AT-521, RN-858, ADR 0214): a fila do
 * projeto e a resposta do usuário. O status sai do LOG — aberta é a que não
 * tem `open_question.answered` —, nunca de tabela.
 */
@Injectable()
export class PerguntasEmAbertoUseCase {
  private readonly logger = new Logger(PerguntasEmAbertoUseCase.name);

  constructor(
    private readonly sessionEvents: SessionEventRepository,
    private readonly sessions: SessionRepository,
    private readonly appendEvent: AppendSessionEventUseCase,
    private readonly unitOfWork: UnitOfWork,
    private readonly engine: ApiToEngineClient,
  ) {}

  async listar(
    projectId: string,
    status: FiltroDeStatus = 'open',
  ): Promise<ListaDePerguntas> {
    const todas = await this.todas(projectId);
    const filtradas = todas
      .filter((p) => status === 'all' || p.status === status)
      .sort((a, b) => b.criadaEm.localeCompare(a.criadaEm));
    const itens = filtradas.slice(0, TETO_DA_LISTA_DE_PERGUNTAS);
    const autores = new Map<string, string | null>();
    for (const p of itens) {
      if (!autores.has(p.sessionId)) {
        const sessao = await this.sessions.findInProject(
          projectId,
          p.sessionId,
        );
        autores.set(p.sessionId, sessao?.createdBy ?? null);
      }
      p.autorDaSessao = autores.get(p.sessionId) ?? null;
    }
    return { itens, total: filtradas.length };
  }

  /** A pergunta foi respondida neste projeto? (RN-859, correção de `ready`.) */
  async foiRespondida(projectId: string, questionId: string) {
    const respostas = await this.sessionEvents.listByTypeForProject(
      projectId,
      EVENTO_PERGUNTA_RESPONDIDA,
    );
    return respostas.some(
      (r) => (r.payload as { questionId?: string }).questionId === questionId,
    );
  }

  async responder(
    projectId: string,
    questionId: string,
    userId: string,
    corpo: { resposta?: string; aceitarSugestao?: boolean },
  ): Promise<PerguntaEmAberto> {
    const pergunta = (await this.todas(projectId)).find(
      (p) => p.questionId === questionId,
    );
    if (!pergunta) {
      throw new NotFoundException(
        `Pergunta "${questionId}" não encontrada neste projeto`,
      );
    }
    const sessao = await this.sessions.findInProject(
      projectId,
      pergunta.sessionId,
    );
    if (!sessao || sessao.createdBy !== userId) {
      throw new ForbiddenException({
        message:
          'Só quem abriu a sessão onde a pergunta nasceu pode respondê-la.',
        reason: 'so_o_autor_da_sessao',
      });
    }
    if (pergunta.status === 'answered') {
      throw new ConflictException({
        message: 'Esta pergunta já foi respondida.',
        reason: 'pergunta_ja_respondida',
      });
    }
    const escolhida = respostaEscolhida(pergunta.sugestao ?? undefined, corpo);
    if (!escolhida) {
      throw new BadRequestException(
        corpo.aceitarSugestao
          ? 'A pergunta não tem sugestão para aceitar.'
          : 'Informe a resposta (até 2000 caracteres) ou aceite a sugestão.',
      );
    }

    const ator = { kind: 'user' as const, id: userId };
    const { decisao, fechamento } = await this.unitOfWork.runInTransaction(
      async () => {
        const decisao = await this.appendEvent.execute(
          projectId,
          pergunta.sessionId,
          {
            type: 'artifact.decision_record',
            actor: ator,
            payload: {
              context: pergunta.pergunta,
              options: pergunta.sugestao ? [pergunta.sugestao] : [],
              choice: escolhida.resposta,
              consequences: descreverAfeta(pergunta.afeta),
              questionId,
              afeta: pergunta.afeta,
            },
          },
        );
        const fechamento = await this.appendEvent.execute(
          projectId,
          pergunta.sessionId,
          {
            type: EVENTO_PERGUNTA_RESPONDIDA,
            actor: ator,
            payload: {
              questionId,
              resposta: escolhida.resposta,
              aceitouSugestao: escolhida.aceitouSugestao,
              decisionEventId: decisao.id,
              respondidaPor: userId,
            },
          },
        );
        return { decisao, fechamento };
      },
    );

    // Religa o gate ESTACIONADO da tarefa afetada (RN-860, caminho da
    // RN-724). Melhor esforço: a resposta já está gravada, e o gate que não
    // estava estacionado (ou o engine fora do ar) não a desfaz.
    for (const taskId of pergunta.afeta.tarefas) {
      try {
        await this.engine.resumeParkedGate(projectId, taskId, 'qa');
      } catch (erro) {
        this.logger.warn(
          `Pergunta ${questionId}: gate da tarefa ${taskId} não foi religado: ${
            erro instanceof Error ? erro.message : String(erro)
          }`,
        );
      }
    }

    return {
      ...pergunta,
      status: 'answered',
      autorDaSessao: sessao.createdBy,
      resposta: {
        texto: escolhida.resposta,
        aceitouSugestao: escolhida.aceitouSugestao,
        decisionEventId: decisao.id,
        respondidaPor: userId,
        respondidaEm: fechamento.createdAt.toISOString(),
      },
    };
  }

  private async todas(projectId: string): Promise<PerguntaEmAberto[]> {
    const [abertas, respostas] = await Promise.all([
      this.sessionEvents.listByTypeForProject(
        projectId,
        EVENTO_PERGUNTA_EM_ABERTO,
      ),
      this.sessionEvents.listByTypeForProject(
        projectId,
        EVENTO_PERGUNTA_RESPONDIDA,
      ),
    ]);
    const porId = new Map<string, SessionEvent>();
    for (const r of respostas) {
      const id = (r.payload as { questionId?: string }).questionId;
      if (id && !porId.has(id)) porId.set(id, r);
    }
    return abertas.map((e) => {
      const p = e.payload as {
        questionId: string;
        pergunta: string;
        sugestao?: string;
        afeta?: Partial<AfetaDaPergunta>;
        autor?: string;
      };
      const r = porId.get(p.questionId);
      const rp = r?.payload as
        | {
            resposta: string;
            aceitouSugestao: boolean;
            decisionEventId: string;
            respondidaPor: string;
          }
        | undefined;
      return {
        questionId: p.questionId,
        eventId: e.id,
        sessionId: e.sessionId,
        pergunta: p.pergunta,
        sugestao: p.sugestao ?? null,
        afeta: {
          regras: p.afeta?.regras ?? [],
          historias: p.afeta?.historias ?? [],
          tarefas: p.afeta?.tarefas ?? [],
        },
        autor: p.autor ?? e.actor.id,
        criadaEm: e.createdAt.toISOString(),
        status: r ? 'answered' : 'open',
        autorDaSessao: null,
        resposta:
          r && rp
            ? {
                texto: rp.resposta,
                aceitouSugestao: rp.aceitouSugestao,
                decisionEventId: rp.decisionEventId,
                respondidaPor: rp.respondidaPor,
                respondidaEm: r.createdAt.toISOString(),
              }
            : null,
      };
    });
  }
}
