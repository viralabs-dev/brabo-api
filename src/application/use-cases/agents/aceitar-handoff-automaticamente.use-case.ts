import { Injectable } from '@nestjs/common';
import { SessionRepository } from '../../ports/session-repository.port';
import { SessionEventRepository } from '../../ports/session-event-repository.port';
import { StoryRepository } from '../../ports/backlog-repository.port';
import { ProvisionedRepositoryRepository } from '../../ports/provisioned-repository-repository.port';
import { GitConnectionRepository } from '../../ports/git-connection-repository.port';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';
import { ResolveEffectiveRoleUseCase } from '../iam/resolve-effective-role.use-case';
import { AcceptHandoffUseCase } from './accept-handoff.use-case';
import { computeCoverage } from '../../../domain/backlog/coverage';
import { GIT_CREDENTIAL_PROVIDER_NAMES } from '../../../domain/git/git-credential-provider-names';
import type { Handoff } from '../../../domain/sessions/handoff.entity';
import {
  AGENTE_QUE_OFERECE_NO_ACEITE_AUTOMATICO,
  AGENTE_QUE_RECEBE_NO_ACEITE_AUTOMATICO,
  ATOR_DO_ACEITE_AUTOMATICO,
  decidirAceiteAutomatico,
  type CriterioDoAceite,
  type MotivoSemAceiteAutomatico,
} from '../../../domain/sessions/aceite-automatico-do-handoff';

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
  ) {}

  async execute(
    projectId: string,
    sessionId: string,
    oferta: Pick<Handoff, 'id' | 'fromAgent' | 'toAgent' | 'status'>,
  ): Promise<DesfechoDoAceiteAutomatico> {
    // Barato antes de ler o banco: só a passagem PO → Arquiteto é candidata.
    if (
      oferta.fromAgent !== AGENTE_QUE_OFERECE_NO_ACEITE_AUTOMATICO ||
      oferta.toAgent !== AGENTE_QUE_RECEBE_NO_ACEITE_AUTOMATICO
    ) {
      return { aceito: false, motivo: 'nao_e_po_para_arquiteto' };
    }

    const session = await this.sessions.findInProject(projectId, sessionId);
    if (!session) return { aceito: false, motivo: 'autor_sem_papel' };

    const [regras, historias, repositorio, credenciais, papel] =
      await Promise.all([
        this.sessionEvents.listByTypeForProject(
          projectId,
          'artifact.business_rule',
        ),
        this.stories.findByProject(projectId),
        this.repositories.findByProjectId(projectId),
        Promise.all(
          GIT_CREDENTIAL_PROVIDER_NAMES.map((p) =>
            this.gitConnections.findMetadataByProjectAndProvider(projectId, p),
          ),
        ),
        this.effectiveRole.forProject(session.createdBy, projectId),
      ]);

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
      fromAgent: oferta.fromAgent,
      toAgent: oferta.toAgent,
      status: oferta.status,
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
