import { Injectable } from '@nestjs/common';
import { SessionEventRepository } from '../../ports/session-event-repository.port';
import {
  EVENTO_IMAGEM_DO_PROJETO,
  RECURSOS_PADRAO,
  SEM_DECISAO,
  validarDecisaoDeImagem,
  versaoDoPayload,
  type DecisaoDeImagem,
  type EstadoDoContainer,
} from '../../../domain/containers/project-container';
import { Traced } from '../../../infrastructure/observability/traced.decorator';

/**
 * O estado do container do projeto: há decisão de imagem vigente?
 *
 * É a leitura do portão (RN-105). Todo mundo que precisa saber se o container
 * pode subir — a aba Code hoje, o provisionador quando existir — pergunta
 * AQUI, e não relê o event log por conta própria: duas leituras do mesmo
 * artefato divergiriam no dia em que o payload mudasse.
 *
 * O vigente é o de maior `version`, com desempate por `seq`. Não é o mais
 * recente por `createdAt` de propósito: `createdAt` é do banco e dois eventos
 * podem cair no mesmo milissegundo, enquanto `version` é o que o artefato
 * declara sobre si.
 */
@Injectable()
export class ObterContainerDoProjetoUseCase {
  constructor(private readonly eventos: SessionEventRepository) {}

  @Traced('application')
  async execute(projectId: string): Promise<EstadoDoContainer> {
    const eventos = await this.eventos.listByTypeForProject(
      projectId,
      EVENTO_IMAGEM_DO_PROJETO,
    );
    if (eventos.length === 0) return SEM_DECISAO;

    const vigente = eventos.reduce((maior, e) =>
      maisNovo(e, maior) ? e : maior,
    );

    const payload = (vigente.payload ?? {}) as Record<string, unknown>;

    // Um payload que não valida mais (schema antigo, gravação de outra época)
    // NÃO derruba a leitura: ele degrada para o default, com a imagem que
    // estiver lá. O portão é sobre EXISTIR decisão; recusar-se a ler uma
    // decisão antiga fecharia a aba Code de um projeto que já tinha passado
    // por ele.
    let decisao: DecisaoDeImagem;
    try {
      decisao = validarDecisaoDeImagem(payload);
    } catch {
      decisao = {
        image: typeof payload.image === 'string' ? payload.image : '(ilegível)',
        rationale:
          typeof payload.rationale === 'string' ? payload.rationale : '',
        network: 'none' as const,
        resources: RECURSOS_PADRAO,
      };
    }

    return {
      status: 'decidido',
      decisao,
      version: versaoDoPayload(payload),
      eventId: vigente.id,
      decidedAt: vigente.createdAt.toISOString(),
    };
  }
}

/**
 * Compara por (version, seq), nessa ordem. Como par, e não como número único:
 * combinar os dois numa conta (`version * 1e6 + seq`) inverteria a ordem
 * assim que uma sessão passasse do fator, e sessão longa é o caso normal.
 */
function maisNovo(
  candidato: { payload: unknown; seq: number },
  atual: { payload: unknown; seq: number },
): boolean {
  const va = versaoDoPayload(candidato.payload);
  const vb = versaoDoPayload(atual.payload);
  if (va !== vb) return va > vb;
  return candidato.seq > atual.seq;
}
