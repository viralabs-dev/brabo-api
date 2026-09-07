import { Injectable, NotFoundException } from '@nestjs/common';
import { MirrorStateRepository } from '../../ports/mirror-state-repository.port';
import { ProjectRepository } from '../../ports/project-repository.port';
import {
  deriveMirrorSyncStatus,
  type MirrorSyncStatus,
} from '../../../domain/iam/mirror-state';
import { Traced } from '../../../infrastructure/observability/traced.decorator';

export interface ProjectMirrorStateView {
  /** O destino DECLARADO hoje (`projects.mirror_path`, RN-515). */
  mirrorPath: string | null;
  /** Qual dos três estados está vigente — nunca deduzido pela tela. */
  status: MirrorSyncStatus;
  lastSyncedAt: string | null;
  filesCopied: number | null;
  filesSkipped: number | null;
  filesRefused: number | null;
  /** O destino da última rodada — congelado, pode divergir de `mirrorPath`. */
  lastDestination: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
}

/**
 * O estado do espelho de um projeto, para a tela (RN-517, ADR 0147 ponto 7).
 *
 * ## Quem deriva os três estados é a api, não a tela
 *
 * `status` sai de `deriveMirrorSyncStatus` — uma função pura do domínio — e
 * viaja pronto. A tela ainda recebe os campos crus (é com eles que ela escreve
 * "412 arquivos em <data>"), mas não recalcula a regra: duas fontes da mesma
 * decisão é como elas divergem, e esta em particular decide qual das TRÊS
 * frases a pessoa lê.
 *
 * ## Os dois destinos, e por que os dois aparecem
 *
 * `mirrorPath` é o que está declarado AGORA; `lastDestination` é onde a última
 * rodada de fato escreveu. Eles divergem quando alguém troca o destino, e a
 * concessão do join (RN-516) só muda quando o runner reconecta — então a tela
 * precisa poder dizer que a última cópia foi para outro lugar em vez de
 * afirmar, com a data de ontem, sobre a pasta de hoje.
 *
 * ## Papel `viewer`, o mesmo de `GET /projects/:projectId`
 *
 * O destino já viaja em toda leitura de projeto (`ProjectResponseDto.
 * mirrorPath`), e este recurso não revela nada além dele mais contagens e uma
 * mensagem de erro. Exigir `maintainer` aqui — o mínimo de quem ESCREVE o
 * destino — trancaria a informação para quem já a vê no mesmo projeto, que é
 * o defeito que a RN-102 nomeia como o pior dos dois.
 */
@Injectable()
export class GetProjectMirrorStateUseCase {
  constructor(
    private readonly projects: ProjectRepository,
    private readonly mirrorStates: MirrorStateRepository,
  ) {}

  @Traced('application')
  async execute(projectId: string): Promise<ProjectMirrorStateView> {
    const project = await this.projects.findById(projectId);
    if (!project) throw new NotFoundException('Projeto não encontrado');

    const state = await this.mirrorStates.findByProject(projectId);

    return {
      mirrorPath: project.mirrorPath,
      status: deriveMirrorSyncStatus(state),
      lastSyncedAt: state?.lastSyncedAt?.toISOString() ?? null,
      filesCopied: state?.filesCopied ?? null,
      filesSkipped: state?.filesSkipped ?? null,
      filesRefused: state?.filesRefused ?? null,
      lastDestination: state?.destination ?? null,
      lastError: state?.lastError ?? null,
      lastErrorAt: state?.lastErrorAt?.toISOString() ?? null,
    };
  }
}
