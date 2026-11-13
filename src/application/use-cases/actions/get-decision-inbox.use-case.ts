import { ForbiddenException, Injectable } from '@nestjs/common';
import { DecisionInboxRepository } from '../../ports/decision-inbox-repository.port';
import { WorkspaceRepository } from '../../ports/workspace-repository.port';
import { papelEfetivo } from '../../../domain/iam/papel-efetivo';
import { roleAtLeast, type Role } from '../../../domain/iam/role';
import { derivarPendenciasDeArquitetura } from '../../../domain/architecture/pendencias-de-arquitetura';
import type { ProposedAction } from '../../../domain/actions/proposed-action.entity';

/** Teto de itens POR FILA (ADR 0060, ADR 0295): o total real sempre acompanha. */
export const TETO_DE_ITENS_POR_FILA = 50;
/** Janela padrão do modo `decided`, a mesma da RN-1154. */
export const JANELA_PADRAO_EM_HORAS = 24;

/**
 * Papel mínimo por fila = o papel de DECIDIR (RN-102: o mínimo é do endpoint).
 * A pendência de arquitetura não tem rota de decisão humana: só se lê.
 */
export const PAPEL_MINIMO_POR_FILA = {
  aprovacoes: 'developer',
  prs: 'developer',
  promocoes: 'developer',
  hipoteses: 'developer',
  arquitetura: 'viewer',
} as const satisfies Record<string, Role>;

type Fila = keyof typeof PAPEL_MINIMO_POR_FILA;
const FILAS = Object.keys(PAPEL_MINIMO_POR_FILA) as Fila[];

export interface FilaDaCaixa<T> {
  total: number;
  truncada: boolean;
  itens: T[];
}

interface ComProjeto {
  projectId: string;
  projectName: string;
}

export interface CaixaDeDecisoes {
  geradoEm: string;
  status: 'pending' | 'decided';
  /** Só no modo `decided`. */
  desde: string | null;
  tetoPorFila: number;
  // Nenhum campo de soma aqui: as filas nunca se somam (RN-467, RN-1196).
  filas: {
    aprovacoes: FilaDaCaixa<ComProjeto & { acao: ProposedAction }>;
    prs: FilaDaCaixa<ComProjeto & { acao: ProposedAction }>;
    promocoes: FilaDaCaixa<
      ComProjeto & {
        storyId: string;
        titulo: string;
        desde: string;
        decididaEm: string | null;
      }
    >;
    arquitetura: FilaDaCaixa<
      ComProjeto & {
        storyId: string;
        titulo: string;
        motivo: 'no_module' | 'missing_module';
        faltando: string[];
        desde: string;
        dataEmprestada: true;
      }
    >;
    hipoteses: FilaDaCaixa<
      ComProjeto & {
        hipoteseId: string;
        hipotese: string;
        agenteAlvo: string;
        situacao: string;
        desde: string;
        decididaEm: string | null;
      }
    >;
  };
  projetos: {
    projectId: string;
    nome: string;
    aprovacoes: number;
    prs: number;
    promocoes: number;
    arquitetura: number;
    hipoteses: number;
    agentesAguardando: string[];
  }[];
}

/**
 * A Caixa de decisões: as cinco filas de todos os projetos que o chamador
 * pode decidir, numa leitura só (AT-928, ADR 0295, RN-1195..1199).
 */
@Injectable()
export class GetDecisionInboxUseCase {
  constructor(
    private readonly inbox: DecisionInboxRepository,
    private readonly workspaces: WorkspaceRepository,
  ) {}

  async execute(
    workspaceId: string,
    userId: string,
    opcoes: { status?: 'pending' | 'decided'; since?: Date } = {},
  ): Promise<CaixaDeDecisoes> {
    const status = opcoes.status ?? 'pending';
    const agora = new Date();
    const desde =
      opcoes.since ??
      new Date(agora.getTime() - JANELA_PADRAO_EM_HORAS * 3_600_000);

    const [papelDoWorkspace, projetos, papeisDeProjeto] = await Promise.all([
      this.workspaces.findMemberRole(workspaceId, userId),
      this.inbox.projetosDoWorkspace(workspaceId),
      this.inbox.papeisDeProjeto(workspaceId, userId),
    ]);
    if (!papelDoWorkspace)
      throw new ForbiddenException('Sem papel no workspace');

    // RN-471 em lote: `projectRole ?? workspaceRole`, a MESMA função pura.
    const linhaDe = new Map(papeisDeProjeto.map((p) => [p.projectId, p.role]));
    const idsPorFila = Object.fromEntries(
      FILAS.map((f) => [
        f,
        projetos
          .filter((p) => {
            const papel = papelEfetivo(linhaDe.get(p.id), papelDoWorkspace);
            return (
              papel !== null && roleAtLeast(papel, PAPEL_MINIMO_POR_FILA[f])
            );
          })
          .map((p) => p.id),
      ]),
    ) as Record<Fila, string[]>;

    const lido = await this.inbox.ler({
      status,
      desde,
      teto: TETO_DE_ITENS_POR_FILA,
      projetos: idsPorFila,
    });

    const nome = new Map(projetos.map((p) => [p.id, p.name]));
    const com = (projectId: string): ComProjeto => ({
      projectId,
      projectName: nome.get(projectId) ?? '',
    });
    const iso = (d: Date) => d.toISOString();

    // Arquitetura: derivada na função pura compartilhada com a aba do projeto.
    const porProjetoArq: Record<string, number> = {};
    const pendenciasArq = [...new Set(lido.historias.map((h) => h.projectId))]
      .flatMap((projectId) => {
        const historias = lido.historias.filter(
          (h) => h.projectId === projectId,
        );
        const atualizadaEm = new Map(historias.map((h) => [h.id, h.updatedAt]));
        return derivarPendenciasDeArquitetura(
          historias,
          lido.modulosPorProjeto[projectId] ?? [],
        ).map((p) => ({ projectId, p, em: atualizadaEm.get(p.storyId)! }));
      })
      .sort((a, b) => a.em.getTime() - b.em.getTime());
    for (const x of pendenciasArq) {
      porProjetoArq[x.projectId] = (porProjetoArq[x.projectId] ?? 0) + 1;
    }

    const fila = <T, U>(
      l: { total: number; itens: T[] },
      mapear: (t: T) => U,
    ): FilaDaCaixa<U> => ({
      total: l.total,
      truncada: l.total > l.itens.length,
      itens: l.itens.map(mapear),
    });

    return {
      geradoEm: iso(agora),
      status,
      desde: status === 'decided' ? iso(desde) : null,
      tetoPorFila: TETO_DE_ITENS_POR_FILA,
      filas: {
        aprovacoes: fila(lido.aprovacoes, (acao) => ({
          ...com(acao.projectId),
          acao,
        })),
        prs: fila(lido.prs, (acao) => ({ ...com(acao.projectId), acao })),
        promocoes: fila(lido.promocoes, (r) => ({
          ...com(r.projectId),
          storyId: r.storyId,
          titulo: r.titulo,
          desde: iso(r.desde),
          decididaEm: r.decididaEm ? iso(r.decididaEm) : null,
        })),
        arquitetura: {
          total: pendenciasArq.length,
          truncada: pendenciasArq.length > TETO_DE_ITENS_POR_FILA,
          itens: pendenciasArq.slice(0, TETO_DE_ITENS_POR_FILA).map((x) => ({
            ...com(x.projectId),
            storyId: x.p.storyId,
            titulo: x.p.title,
            motivo: x.p.reason,
            faltando: x.p.missing,
            desde: iso(x.em),
            dataEmprestada: true as const,
          })),
        },
        hipoteses: fila(lido.hipoteses, (r) => ({
          ...com(r.projectId),
          hipoteseId: r.hipoteseId,
          hipotese: r.hipotese,
          agenteAlvo: r.agenteAlvo,
          situacao: r.situacao,
          desde: iso(r.desde),
          decididaEm: r.decididaEm ? iso(r.decididaEm) : null,
        })),
      },
      // Cinco números SEPARADOS por projeto (zero onde o papel não alcança a fila).
      projetos: projetos.map((p) => ({
        projectId: p.id,
        nome: p.name,
        aprovacoes: lido.aprovacoes.porProjeto[p.id] ?? 0,
        prs: lido.prs.porProjeto[p.id] ?? 0,
        promocoes: lido.promocoes.porProjeto[p.id] ?? 0,
        arquitetura: porProjetoArq[p.id] ?? 0,
        hipoteses: lido.hipoteses.porProjeto[p.id] ?? 0,
        agentesAguardando: lido.agentesAguardando[p.id] ?? [],
      })),
    };
  }
}
