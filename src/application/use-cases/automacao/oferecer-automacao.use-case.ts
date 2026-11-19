import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SessionEventRepository } from '../../ports/session-event-repository.port';
import { ProvisionedRepositoryRepository } from '../../ports/provisioned-repository-repository.port';
import { GitConnectionRepository } from '../../ports/git-connection-repository.port';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';
import {
  AutomacoesDoProjetoUseCase,
  type AutomacaoResolvida,
} from '../iam/automacoes-do-projeto.use-case';
import { GIT_CREDENTIAL_PROVIDER_NAMES } from '../../../domain/git/git-credential-provider-names';
import {
  assinaturaDe,
  avaliarRepeticao,
  chaveDaRegra,
  decisoesDosEventos,
  JANELA_DA_REPETICAO_MS,
  normalizarMotivo,
  tipoAutomatizavel,
  type CategoriaDaDecisao,
  type Oferta,
} from '../../../domain/automacao/repeticao';

export const EVENTO_OFERECIDA = 'automacao.oferecida';
export const EVENTO_RECUSADA = 'automacao.recusada';
export const EVENTO_ACEITA = 'automacao.aceita';
export const EVENTO_APLICADA = 'automacao.aplicada';
export const EVENTO_OUTRO_CAMINHO = 'automacao.outro_caminho';

const ATOR_DA_OFERTA = { kind: 'system' as const, id: 'automacao-oferta' };
const TIPOS_LIDOS = [
  'proposed_action.approved',
  'proposed_action.denied',
  'handoff.accepted',
  'backlog.task_unblocked',
  'backlog.task_blocked',
];

interface PayloadDaOferta {
  categoria: CategoriaDaDecisao;
  chave: string;
  escopo: string;
}

/**
 * O Brabo percebe a decisão repetida e oferece fazê-la sozinho (AT-998,
 * RN-1435..RN-1438). Chamado DEPOIS do commit da decisão (nunca dentro da
 * transação) e em melhor esforço: a oferta é conveniência, e falhar em
 * oferecê-la nunca desfaz nem atrasa a decisão da pessoa.
 *
 * O contrato com a web (AT-999) são os eventos de sessão `automacao.*` e as
 * rotas `POST`/`DELETE /projects/:id/automacoes`.
 */
@Injectable()
export class OferecerAutomacaoUseCase {
  private readonly logger = new Logger(OferecerAutomacaoUseCase.name);

  constructor(
    private readonly events: SessionEventRepository,
    private readonly appendEvent: AppendSessionEventUseCase,
    private readonly automacoes: AutomacoesDoProjetoUseCase,
    private readonly repositories: ProvisionedRepositoryRepository,
    private readonly gitConnections: GitConnectionRepository,
  ) {}

  /** Repositório `local` e nenhuma credencial de git no projeto (decisão 3 da AT-953). */
  async repositorioLocalSemCredencial(projectId: string): Promise<boolean> {
    const [repositorio, credenciais] = await Promise.all([
      this.repositories.findByProjectId(projectId),
      Promise.all(
        GIT_CREDENTIAL_PROVIDER_NAMES.map((p) =>
          this.gitConnections.findMetadataByProjectAndProvider(projectId, p),
        ),
      ),
    ]);
    return repositorio?.provider === 'local' && credenciais.every((c) => !c);
  }

  async aposDecisao(
    projectId: string,
    sessionId: string,
    categoria: CategoriaDaDecisao,
  ): Promise<Oferta | null> {
    try {
      return await this.oferecer(projectId, sessionId, categoria);
    } catch (erro) {
      this.logger.warn(
        `oferta_falhou projectId=${projectId}: ${erro instanceof Error ? erro.message : String(erro)}`,
      );
      return null;
    }
  }

  private async oferecer(
    projectId: string,
    sessionId: string,
    categoria: CategoriaDaDecisao,
  ): Promise<Oferta | null> {
    const agora = new Date();
    const desde = new Date(agora.getTime() - JANELA_DA_REPETICAO_MS);
    const eventos = (
      await Promise.all(
        TIPOS_LIDOS.map((t) =>
          this.events.listByTypeForProject(projectId, t, desde),
        ),
      )
    ).flat();
    const historico = decisoesDosEventos(eventos);
    const atual = [...historico]
      .reverse()
      .find((d) => d.categoria === categoria);
    if (!atual) return null;

    const [oferecidas, recusadas, regras, localSemCredencial] =
      await Promise.all([
        this.events.listByTypeForProject(projectId, EVENTO_OFERECIDA),
        this.events.listByTypeForProject(projectId, EVENTO_RECUSADA),
        this.automacoes.listar(projectId),
        atual.chave === 'open_infra_pr'
          ? this.repositorioLocalSemCredencial(projectId)
          : Promise.resolve(false),
      ]);
    const jaTratadas = new Set<string>([
      ...[...oferecidas, ...recusadas].map((e) =>
        assinaturaDe(e.payload as PayloadDaOferta),
      ),
      // Regra que já existe (aceita ou desfeita) também não volta a ser oferecida.
      ...regras.map((r) => assinaturaDaRegra(r)),
    ]);

    const oferta = avaliarRepeticao(atual, historico, {
      agora,
      repositorioLocalSemCredencial: localSemCredencial,
      jaTratadas,
    });
    if (oferta.oferecer === true) {
      await this.appendEvent.execute(projectId, sessionId, {
        type: EVENTO_OFERECIDA,
        actor: ATOR_DA_OFERTA,
        payload: {
          categoria: oferta.categoria,
          chave: oferta.chave,
          escopo: oferta.escopo,
          n: oferta.n,
          // O escopo e o desfazer, ditos na oferta (AT-953, decisão 3).
          escopoDaRegra: 'projeto',
          comoDesfazer: `DELETE /projects/${projectId}/automacoes/${oferta.categoria}/${encodeURIComponent(chaveDaRegra(oferta))}`,
        },
      });
    } else if (oferta.oferecer === 'outro_caminho') {
      await this.appendEvent.execute(projectId, sessionId, {
        type: EVENTO_OUTRO_CAMINHO,
        actor: ATOR_DA_OFERTA,
        payload: {
          categoria: atual.categoria,
          chave: atual.chave,
          opcoes: [...oferta.opcoes],
        },
      });
    }
    return oferta;
  }

  /** A regra de aprovação vale para esta ação? (`decide()` consulta a cada proposta.) */
  async regraDaAprovacao(
    projectId: string,
    actionType: string,
    agente: string,
  ): Promise<AutomacaoResolvida | null> {
    // Barato antes de ler o banco: o que nunca vira regra não consulta nada.
    if (tipoAutomatizavel(actionType, true) !== null) return null;
    const regra = await this.automacoes.regraDaOfertaLigada(
      projectId,
      'aprovacao',
      chaveDaRegra({ chave: actionType, escopo: agente }),
    );
    if (!regra) return null;
    // `open_infra_pr` só vale em repositório local sem credencial — conferido a
    // cada proposta: ligar uma credencial depois derruba a regra na hora.
    if (
      actionType === 'open_infra_pr' &&
      !(await this.repositorioLocalSemCredencial(projectId))
    ) {
      return null;
    }
    return regra;
  }

  /** A regra de desbloqueio vale para esta tarefa? No máximo UMA vez por tarefa (anti-laço). */
  async regraDoDesbloqueio(
    projectId: string,
    taskId: string,
    motivo: string,
  ): Promise<AutomacaoResolvida | null> {
    const regra = await this.automacoes.regraDaOfertaLigada(
      projectId,
      'desbloqueio',
      normalizarMotivo(motivo),
    );
    if (!regra) return null;
    const jaFoi = (
      await this.events.listByTypeForProject(
        projectId,
        'backlog.task_unblocked',
        new Date(Date.now() - JANELA_DA_REPETICAO_MS),
      )
    ).some((e) => {
      const p = e.payload as { taskId?: string; automacao?: boolean };
      return p.automacao === true && p.taskId === taskId;
    });
    return jaFoi ? null : regra;
  }

  /** Quando a regra age: o rastro que a linha "feito sozinho · desfazer" lê. */
  async registrarAplicada(
    projectId: string,
    sessionId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.appendEvent.execute(projectId, sessionId, {
        type: EVENTO_APLICADA,
        actor: ATOR_DA_OFERTA,
        payload,
      });
    } catch (erro) {
      this.logger.warn(
        `aplicada_nao_registrada projectId=${projectId}: ${erro instanceof Error ? erro.message : String(erro)}`,
      );
    }
  }

  /** Aceite ou recusa da oferta (`POST /projects/:id/automacoes`). */
  async responder(
    projectId: string,
    userId: string,
    pedido: PayloadDaOferta & { decisao: 'aceitar' | 'recusar' },
  ): Promise<AutomacaoResolvida[]> {
    const { categoria, chave, escopo, decisao } = pedido;
    const assinatura = assinaturaDe({ categoria, chave, escopo });
    const mesma = (e: { payload: unknown }) =>
      assinaturaDe(e.payload as PayloadDaOferta) === assinatura;
    const oferta = (
      await this.events.listByTypeForProject(projectId, EVENTO_OFERECIDA)
    ).find(mesma);
    if (!oferta) throw new NotFoundException('Esta oferta não existe');
    const [aceitas, recusadas] = await Promise.all([
      this.events.listByTypeForProject(projectId, EVENTO_ACEITA),
      this.events.listByTypeForProject(projectId, EVENTO_RECUSADA),
    ]);
    if ([...aceitas, ...recusadas].some(mesma)) {
      throw new ConflictException('Esta oferta já foi respondida');
    }
    if (decisao === 'aceitar') {
      // O teto é conferido DE NOVO no aceite: a oferta pode ser antiga, e uma
      // credencial de git ligada nesse meio-tempo fecha `open_infra_pr`.
      if (categoria === 'aprovacao') {
        const motivo = tipoAutomatizavel(
          chave,
          await this.repositorioLocalSemCredencial(projectId),
        );
        if (motivo) {
          throw new BadRequestException({
            message: `"${chave}" não pode virar regra: ${motivo}`,
            reason: motivo,
          });
        }
      }
      await this.automacoes.gravarRegraDaOferta(
        projectId,
        userId,
        categoria,
        chaveDaRegra({ chave, escopo }),
      );
    }
    await this.appendEvent.execute(projectId, oferta.sessionId, {
      type: decisao === 'aceitar' ? EVENTO_ACEITA : EVENTO_RECUSADA,
      actor: { kind: 'user', id: userId },
      payload: { categoria, chave, escopo },
    });
    return this.automacoes.listar(projectId);
  }
}

function assinaturaDaRegra(r: AutomacaoResolvida): string {
  const i = r.chave.lastIndexOf('@');
  return r.categoria === 'aprovacao' && i > 0
    ? assinaturaDe({
        categoria: 'aprovacao',
        chave: r.chave.slice(0, i),
        escopo: r.chave.slice(i + 1),
      })
    : assinaturaDe({
        categoria: r.categoria as CategoriaDaDecisao,
        chave: r.chave,
        escopo: '',
      });
}
