import { Injectable } from '@nestjs/common';
import { SessionRepository } from '../../ports/session-repository.port';
import { SessionEventRepository } from '../../ports/session-event-repository.port';
import { StoryRepository } from '../../ports/backlog-repository.port';
import { ProvisionedRepositoryRepository } from '../../ports/provisioned-repository-repository.port';
import { GitConnectionRepository } from '../../ports/git-connection-repository.port';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';
import { ResolveEffectiveRoleUseCase } from '../iam/resolve-effective-role.use-case';
import { ModuleMapRepository } from '../../ports/module-map-repository.port';
import { InfraArtifactRepository } from '../../ports/infra-artifact-repository.port';
import { ContainerRepository } from '../../ports/container-repository.port';
import { ListInfraArtifactsUseCase } from '../execution/list-infra-artifacts.use-case';
import { AutomacoesDoProjetoUseCase } from '../iam/automacoes-do-projeto.use-case';
import { OferecerAutomacaoUseCase } from '../automacao/oferecer-automacao.use-case';
import {
  EVENTO_PERGUNTA_EM_ABERTO,
  EVENTO_PERGUNTA_RESPONDIDA,
} from '../../../domain/open-questions/pergunta-em-aberto';
import { AcceptHandoffUseCase } from './accept-handoff.use-case';
import { computeCoverage } from '../../../domain/backlog/coverage';
import { GIT_CREDENTIAL_PROVIDER_NAMES } from '../../../domain/git/git-credential-provider-names';
import type { Handoff } from '../../../domain/sessions/handoff.entity';
import {
  AGENTE_QUE_OFERECE_NO_ACEITE_AUTOMATICO,
  AGENTE_QUE_RECEBE_NO_ACEITE_AUTOMATICO,
  ATOR_DO_ACEITE_AUTOMATICO,
  decidirAceiteAutomatico,
  passagemDe,
  CATEGORIA_DA_PASSAGEM,
  type EntradaDoAceiteAutomatico,
  type CriterioDoAceite,
  type MotivoSemAceiteAutomatico,
} from '../../../domain/sessions/aceite-automatico-do-handoff';
import { idsDeRegrasRetiradas } from '../backlog/regras-retiradas';

/** O que a oferta devolve ao engine sobre o aceite sem clique (RN-660). */
export type DesfechoDoAceiteAutomatico =
  | { aceito: true; criterio: CriterioDoAceite }
  | { aceito: false; motivo: MotivoSemAceiteAutomatico | 'falhou' };

/**
 * Aceita SEM CLIQUE o handoff do PO ao Arquiteto quando o backlog está coberto
 * e o repositório é local e sem credencial (RN-660, ADR 0186 — que revisita o
 * ADR 0165 sem editá-lo).
 *
 * Não é um segundo caminho de aceite: quem aceita é `AcceptHandoffUseCase`, e
 * é lá que o repositório continua nascendo, antes de `activateAgent` (RN-582).
 * Este caso de uso só LÊ o que a decisão pede, decide pelo predicado puro
 * (`decidirAceiteAutomatico`) e, com "sim", chama o aceite com o ator de
 * SISTEMA e o critério no payload — é isso que torna o aceite auditável.
 *
 * Com "não", nada é gravado: a oferta fica `offered` e o card de sempre pede o
 * clique. A falha DEPOIS de decidir "sim" não pode subir — a oferta já está
 * commitada e o engine espera a resposta dela —, então vira evento nomeado
 * (`handoff.auto_accept_failed`, com origem) e a resposta diz `falhou`.
 */
@Injectable()
export class AceitarHandoffAutomaticamenteUseCase {
  constructor(
    private readonly sessions: SessionRepository,
    private readonly sessionEvents: SessionEventRepository,
    private readonly stories: StoryRepository,
    private readonly repositories: ProvisionedRepositoryRepository,
    private readonly gitConnections: GitConnectionRepository,
    private readonly effectiveRole: ResolveEffectiveRoleUseCase,
    private readonly appendEvent: AppendSessionEventUseCase,
    private readonly acceptHandoff: AcceptHandoffUseCase,
    private readonly automacoes: AutomacoesDoProjetoUseCase,
    private readonly moduleMaps: ModuleMapRepository,
    private readonly infraArtifacts: InfraArtifactRepository,
    private readonly infraAbertas: ListInfraArtifactsUseCase,
    private readonly containers: ContainerRepository,
    private readonly ofertas?: OferecerAutomacaoUseCase,
  ) {}

  /** Lê só os fatos da passagem pedida (RN-1422/RN-1423); o resto da conta fica no domínio. */
  private async fatosDaPassagem(
    projectId: string,
    passagem: NonNullable<ReturnType<typeof passagemDe>>,
  ): Promise<Partial<EntradaDoAceiteAutomatico>> {
    const passagemLigada = await this.automacoes.passagemLigada(
      projectId,
      passagem,
    );
    if (!passagemLigada) return { passagemLigada };
    if (passagem === 'arquiteto->infra') {
      const [mapa, adrs, abertas, respondidas] = await Promise.all([
        this.moduleMaps.findCurrent(projectId),
        this.sessionEvents.listByTypeForProject(projectId, 'adr.pr_opened'),
        this.sessionEvents.listByTypeForProject(
          projectId,
          EVENTO_PERGUNTA_EM_ABERTO,
        ),
        this.sessionEvents.listByTypeForProject(
          projectId,
          EVENTO_PERGUNTA_RESPONDIDA,
        ),
      ]);
      const respondidasIds = new Set(
        respondidas.map(
          (r) => (r.payload as { questionId?: string }).questionId,
        ),
      );
      const doArquiteto = abertas.filter((e) => {
        const p = e.payload as { autor?: string; questionId?: string };
        return p.autor === 'arquiteto' && !respondidasIds.has(p.questionId);
      });
      return {
        passagemLigada,
        arquitetura: {
          moduleMapVigente: mapa !== null,
          adrProposta: adrs.length > 0,
          perguntasEmAberto: doArquiteto.length,
        },
      };
    }
    const [todas, emRevisao, ciclo] = await Promise.all([
      this.infraArtifacts.listByProject(projectId),
      this.infraAbertas.execute(projectId),
      this.containers.findByProject(projectId),
    ]);
    return {
      passagemLigada,
      infra: {
        prsMergeadas: todas.length > 0 && emRevisao.length === 0,
        // `running` só é gravado depois da prova de rede (RN-1366).
        containerRodando: ciclo?.status === 'running',
      },
    };
  }

  async execute(
    projectId: string,
    sessionId: string,
    oferta: Pick<Handoff, 'id' | 'fromAgent' | 'toAgent' | 'status'>,
  ): Promise<DesfechoDoAceiteAutomatico> {
    // Barato antes de ler o banco: só PO → Arquiteto e as duas passagens da
    // AT-994 (Arquiteto → Infra, Infra → Dev Lead) são candidatas.
    const passagem = passagemDe(oferta.fromAgent, oferta.toAgent);
    // AT-998: ou a passagem tem uma regra aceita da oferta (lida no banco).
    const regraDaOferta =
      !passagem &&
      !(
        oferta.fromAgent === AGENTE_QUE_OFERECE_NO_ACEITE_AUTOMATICO &&
        oferta.toAgent === AGENTE_QUE_RECEBE_NO_ACEITE_AUTOMATICO
      )
        ? await this.automacoes.regraDaOfertaLigada(
            projectId,
            CATEGORIA_DA_PASSAGEM,
            `${oferta.fromAgent}->${oferta.toAgent}`,
          )
        : null;
    if (
      !passagem &&
      !regraDaOferta &&
      (oferta.fromAgent !== AGENTE_QUE_OFERECE_NO_ACEITE_AUTOMATICO ||
        oferta.toAgent !== AGENTE_QUE_RECEBE_NO_ACEITE_AUTOMATICO)
    ) {
      return { aceito: false, motivo: 'passagem_sem_aceite_automatico' };
    }

    const session = await this.sessions.findInProject(projectId, sessionId);
    if (!session) return { aceito: false, motivo: 'autor_sem_papel' };

    const [
      todasAsRegras,
      retiradas,
      historias,
      repositorio,
      credenciais,
      papel,
    ] = await Promise.all([
      this.sessionEvents.listByTypeForProject(
        projectId,
        'artifact.business_rule',
      ),
      idsDeRegrasRetiradas(this.sessionEvents, projectId),
      this.stories.findByProject(projectId),
      this.repositories.findByProjectId(projectId),
      Promise.all(
        GIT_CREDENTIAL_PROVIDER_NAMES.map((p) =>
          this.gitConnections.findMetadataByProjectAndProvider(projectId, p),
        ),
      ),
      this.effectiveRole.forProject(session.createdBy, projectId),
    ]);

    const regras = todasAsRegras.filter((e) => !retiradas.has(e.id)); // RN-1018
    // A MESMA conta da aba Backlog (`GetCoverageUseCase`): duas contas do
    // mesmo fato divergiriam no primeiro ajuste.
    const cobertura = computeCoverage(
      regras.map((e) => ({ id: e.id, title: '' })),
      historias.map((s) => ({
        id: s.id,
        title: s.title,
        businessRuleIds: s.businessRuleIds,
      })),
    );

    const decisao = decidirAceiteAutomatico({
      ...(passagem ? await this.fatosDaPassagem(projectId, passagem) : {}),
      fromAgent: oferta.fromAgent,
      toAgent: oferta.toAgent,
      status: oferta.status,
      regraDaOferta: regraDaOferta !== null,
      cobertura: {
        regras: cobertura.rules.length,
        semHistoria: cobertura.uncoveredCount,
      },
      providerDoRepositorio: repositorio?.provider ?? null,
      credencialDeGitNoProjeto: credenciais.some((c) => c !== null),
      papelDoAutor: papel,
    });

    if (!decisao.aceita) return { aceito: false, motivo: decisao.motivo };

    try {
      await this.acceptHandoff.execute(
        projectId,
        sessionId,
        oferta.id,
        session.createdBy,
        {
          ator: ATOR_DO_ACEITE_AUTOMATICO,
          criterio: { ...decisao.criterio },
        },
      );
      // AT-998 (RN-1438): a regra aceita da oferta agiu — o rastro.
      if (regraDaOferta) {
        await this.ofertas?.registrarAplicada(projectId, sessionId, {
          categoria: 'handoff',
          chave: `${oferta.fromAgent}->${oferta.toAgent}`,
          handoffId: oferta.id,
          regraDesde: regraDaOferta.alteradaEm,
        });
      }
      return { aceito: true, criterio: decisao.criterio };
    } catch (erro) {
      const mensagem = erro instanceof Error ? erro.message : String(erro);
      await this.appendEvent.execute(projectId, sessionId, {
        type: 'handoff.auto_accept_failed',
        actor: ATOR_DO_ACEITE_AUTOMATICO,
        payload: {
          handoffId: oferta.id,
          toAgent: oferta.toAgent,
          origem: 'infra',
          error: mensagem,
        },
      });
      return { aceito: false, motivo: 'falhou' };
    }
  }
}
