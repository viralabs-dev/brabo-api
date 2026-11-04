import { Injectable, Logger } from '@nestjs/common';
import { ApiToEngineClient } from '../../ports/api-to-engine-client.port';
import { AgentInstructionRepository } from '../../ports/agent-instruction-repository.port';

/** Teto do texto de instrução e da descrição de ferramenta (ADR 0060, RN-589). */
export const TETO_DE_INSTRUCAO = 8000;
export const TETO_DE_DESCRICAO = 1000;

export interface AgenteDoCatalogo {
  agente: string;
  identidade: string | null;
  instrucoesDoProjeto: {
    versao: number;
    conteudo: string;
    conteudoTotal?: number;
  } | null;
  ferramentas: Array<{ nome: string; descricao: string }> | null;
}

export interface CatalogoDeAgentes {
  agentes: AgenteDoCatalogo[];
  motivoSemCatalogo?: 'engine_indisponivel';
}

/**
 * Catálogo só-leitura de cada agente (AT-686, RN-995): identidade e
 * ferramentas vêm do engine; a instrução vigente, do banco. Engine fora do ar
 * devolve `null` com o motivo, nunca lista vazia (RN-470).
 */
@Injectable()
export class GetAgentCatalogUseCase {
  private readonly logger = new Logger(GetAgentCatalogUseCase.name);

  constructor(
    private readonly engine: ApiToEngineClient,
    private readonly instructions: AgentInstructionRepository,
  ) {}

  async execute(projectId: string): Promise<CatalogoDeAgentes> {
    const [catalogo, doProjeto] = await Promise.all([
      this.engine.getAgentCatalog().catch((e: unknown) => {
        this.logger.warn(`catálogo do engine indisponível: ${String(e)}`);
        return null;
      }),
      this.instructions.listByProject(projectId),
    ]);
    const porSlug = new Map(doProjeto.map((i) => [i.agent, i]));
    const doEngine = new Map(
      (catalogo?.agentes ?? []).map((a) => [a.agente, a]),
    );
    // `dev-api` não tem entrada própria: o engine devolve uma só, `dev-*`.
    const slugs = new Set([...doEngine.keys(), ...porSlug.keys()]);
    const agentes = [...slugs]
      .filter((s) => s !== 'dev-*')
      .sort()
      .map((agente): AgenteDoCatalogo => {
        const e =
          doEngine.get(agente) ??
          (agente.startsWith('dev-') ? doEngine.get('dev-*') : undefined);
        const i = porSlug.get(agente);
        return {
          agente,
          identidade: e?.identidade ?? null,
          instrucoesDoProjeto: i
            ? {
                versao: i.version,
                conteudo: i.content.slice(0, TETO_DE_INSTRUCAO),
                ...(i.content.length > TETO_DE_INSTRUCAO && {
                  conteudoTotal: i.content.length,
                }),
              }
            : null,
          ferramentas:
            e?.ferramentas.map((f) => ({
              nome: f.nome,
              descricao: f.descricao.slice(0, TETO_DE_DESCRICAO),
            })) ?? null,
        };
      });
    return catalogo
      ? { agentes }
      : { agentes, motivoSemCatalogo: 'engine_indisponivel' };
  }
}
