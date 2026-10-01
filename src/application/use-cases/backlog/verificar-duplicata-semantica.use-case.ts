import { Injectable, Logger } from '@nestjs/common';
import { StoryRepository } from '../../ports/backlog-repository.port';
import { SessionEventRepository } from '../../ports/session-event-repository.port';
import { ModelRepository } from '../../ports/model-repository.port';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';
import { RecordLlmUsageUseCase } from '../llm/record-llm-usage.use-case';
import { RagEmbeddingService } from '../rag/rag-embedding.service';
import {
  RAG_EMBEDDING_MODEL,
  RAG_EMBEDDING_PROVIDER,
} from '../../../domain/rag/rag-search-limits';
import {
  ehDuplicataSemantica,
  LIMIAR_DE_DUPLICATA_SEMANTICA,
  maisParecida,
  TETO_DE_COMPARACOES_DE_DUPLICATA,
  TETO_DE_TEMPO_DA_CHECAGEM_MS,
  type TipoDeItem,
} from '../../../domain/backlog/duplicata-semantica';
import { normalizarTitulo } from '../../../domain/backlog/story-overlap';
import { calculateCostMicros } from '../../../domain/llm/cost-calculator';
import type { Actor } from '../../../domain/sessions/session-event.entity';

/**
 * O ator do metering e dos eventos desta checagem — `system`, nunca o agente
 * que emitiu: o gasto é do PRODUTO verificando, não do turno do agente, e é
 * assim que ele aparece como LINHA PRÓPRIA em `token_usage` sem entrar nas
 * somas por agente (RN-038 filtra `actorKind = 'agent'`) nem no gasto da área
 * do agente (ADR 0110). ADR 0198.
 */
export const ATOR_DA_DUPLICATA_SEMANTICA: Actor = {
  kind: 'system',
  id: 'duplicata-semantica',
};

export interface VerificarDuplicataSemanticaInput {
  projectId: string;
  sessionId: string;
  kind: TipoDeItem;
  /**
   * O id do item JÁ gravado, quando quem chama o tem (a história). A regra é
   * gravada pelo engine por `append_event`, que não devolve id — e ela sai da
   * comparação pelo TÍTULO normalizado: a RN-080 garante que no projeto só
   * existe uma regra com ele, a recém-gravada.
   */
  itemId: string | null;
  title: string;
}

/** Wire em inglês (é corpo HTTP), como os outros DTOs da api. */
export type SemanticDuplicateCheck =
  | {
      status: 'warned';
      similarTo: { id: string; title: string };
      similarity: number;
      threshold: number;
      compared: number;
      total: number;
    }
  | {
      status: 'clean';
      closest: { id: string; title: string; similarity: number } | null;
      threshold: number;
      compared: number;
      total: number;
    }
  | { status: 'skipped'; reason: string }
  | { status: 'nothing_to_compare' };

/** O resultado + a frase que o agente lê ({@link fraseParaOAgente}). */
export type SemanticDuplicateCheckResult = SemanticDuplicateCheck & {
  message: string | null;
};

interface Existente {
  id: string;
  title: string;
  createdAt: Date;
}

/**
 * A checagem de duplicata SEMÂNTICA na emissão de história e de regra de
 * negócio (RN-681, ADR 0198, AT-171): vetoriza o título novo e os das
 * existentes do PROJETO, e AVISA quando a mais próxima passa do limiar.
 *
 * ## Nunca falha a emissão
 *
 * Quem chama já gravou o item. Toda falha daqui — provider sem a capability,
 * daemon fora do ar, teto de tempo, erro inesperado — vira `skipped` com o
 * MOTIVO, narrado no log como `backlog.semantic_duplicate_check_skipped`.
 * Pular calado seria pior que não ter a checagem: a pessoa leria "sem aviso"
 * como "não é duplicata".
 *
 * ## O gasto entra no metering (exceção ao corte do ADR 0075)
 *
 * Há `session_id`, então a linha cabe em `token_usage`: ator
 * {@link ATOR_DA_DUPLICATA_SEMANTICA}, provider/modelo do RAG, saída zero,
 * preço do catálogo quando o modelo está nele (Ollama local costuma ser 0).
 * O resto do gasto de embedding (indexação, busca) segue fora — o corte do
 * 0075 não muda, ganha UMA exceção.
 *
 * ## Por que calcula na hora
 *
 * Nenhuma história nem regra tem vetor guardado: `chunks` indexa conversa e
 * docs, não artefato, e regra de negócio é evento (sem tabela onde pôr a
 * coluna). Cada checagem vetoriza `min(N, TETO) + 1` títulos num lote só —
 * medido no ADR 0198. Guardar vetor é a otimização óbvia e é migration; fica
 * para quando o custo medido pedir.
 */
@Injectable()
export class VerificarDuplicataSemanticaUseCase {
  private readonly logger = new Logger(VerificarDuplicataSemanticaUseCase.name);

  constructor(
    private readonly stories: StoryRepository,
    private readonly sessionEvents: SessionEventRepository,
    private readonly models: ModelRepository,
    private readonly embeddings: RagEmbeddingService,
    private readonly recordUsage: RecordLlmUsageUseCase,
    private readonly appendEvent: AppendSessionEventUseCase,
  ) {}

  async execute(
    input: VerificarDuplicataSemanticaInput,
  ): Promise<SemanticDuplicateCheckResult> {
    let resultado: SemanticDuplicateCheck;
    try {
      resultado = await comTeto(
        this.verificar(input),
        TETO_DE_TEMPO_DA_CHECAGEM_MS,
      );
    } catch (erro) {
      const motivo =
        erro instanceof TetoDeTempoEstourado
          ? `o embedding não respondeu em ${TETO_DE_TEMPO_DA_CHECAGEM_MS / 1000} s`
          : `erro inesperado na checagem: ${erro instanceof Error ? erro.message : String(erro)}`;
      resultado = { status: 'skipped', reason: motivo };
    }

    await this.narrar(input, resultado);
    return { ...resultado, message: fraseParaOAgente(input.kind, resultado) };
  }

  private async verificar(
    input: VerificarDuplicataSemanticaInput,
  ): Promise<SemanticDuplicateCheck> {
    // Título normalizado igual é a duplicata EXATA, assunto da RN-080/081 (que
    // recusa) — e, depois de gravar, é o próprio item. Nunca é o aviso daqui.
    const alvo = normalizarTitulo(input.title);
    const todas = (await this.existentes(input.projectId, input.kind)).filter(
      (e) => e.id !== input.itemId && normalizarTitulo(e.title) !== alvo,
    );
    if (todas.length === 0) return { status: 'nothing_to_compare' };

    const comparadas = [...todas]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, TETO_DE_COMPARACOES_DE_DUPLICATA);

    const inicio = Date.now();
    const lote = await this.embeddings.embedMany([
      input.title,
      ...comparadas.map((e) => e.title),
    ]);
    const latencyMs = Date.now() - inicio;

    // O que o provider cobrou entra no metering MESMO quando um lote
    // seguinte falhou: gasto que houve não deixa de ter havido.
    if (lote.uso && lote.uso.inputTokens > 0) {
      await this.medir(input, lote.uso, latencyMs);
    }

    const [vetorNovo, ...vetores] = lote.vectors;
    if (!lote.available || !vetorNovo || vetores.some((v) => v === null)) {
      return {
        status: 'skipped',
        reason:
          lote.reason ??
          `provider "${RAG_EMBEDDING_PROVIDER}" não devolveu os vetores`,
      };
    }

    const parecida = maisParecida(
      vetorNovo,
      comparadas.map((e, i) => ({
        id: e.id,
        title: e.title,
        vetor: vetores[i]!,
      })),
    );

    const base = {
      threshold: LIMIAR_DE_DUPLICATA_SEMANTICA,
      compared: comparadas.length,
      total: todas.length,
    };
    if (parecida && ehDuplicataSemantica(parecida.similaridade)) {
      return {
        status: 'warned',
        similarTo: { id: parecida.id, title: parecida.title },
        similarity: arredondar(parecida.similaridade),
        ...base,
      };
    }
    return {
      status: 'clean',
      closest: parecida
        ? {
            id: parecida.id,
            title: parecida.title,
            similarity: arredondar(parecida.similaridade),
          }
        : null,
      ...base,
    };
  }

  private async existentes(
    projectId: string,
    kind: TipoDeItem,
  ): Promise<Existente[]> {
    if (kind === 'story') {
      const stories = await this.stories.findByProject(projectId);
      return stories.map((s) => ({
        id: s.id,
        title: s.title,
        createdAt: s.createdAt,
      }));
    }
    const regras = await this.sessionEvents.listByTypeForProject(
      projectId,
      'artifact.business_rule',
    );
    return regras.flatMap((e) => {
      const titulo = (e.payload as { title?: unknown } | null)?.title;
      return typeof titulo === 'string' && titulo.trim() !== ''
        ? [{ id: e.id, title: titulo, createdAt: e.createdAt }]
        : [];
    });
  }

  private async medir(
    input: VerificarDuplicataSemanticaInput,
    uso: { inputTokens: number; estimated: boolean; model: string },
    latencyMs: number,
  ): Promise<void> {
    try {
      const catalogo = await this.models.listByProvider(RAG_EMBEDDING_PROVIDER);
      const linha =
        catalogo.find((m) => m.name === uso.model) ??
        catalogo.find(
          (m) =>
            m.name === RAG_EMBEDDING_MODEL ||
            m.name.startsWith(`${RAG_EMBEDDING_MODEL}:`),
        ) ??
        null;
      const precoDeEntrada = linha?.inputPricePerMillionMicros ?? 0;

      await this.recordUsage.execute({
        projectId: input.projectId,
        sessionId: input.sessionId,
        actor: ATOR_DA_DUPLICATA_SEMANTICA,
        provider: RAG_EMBEDDING_PROVIDER,
        modelId: linha?.id ?? null,
        modelName: linha?.name ?? uso.model,
        inputTokens: uso.inputTokens,
        outputTokens: 0,
        estimated: uso.estimated,
        costMicros: calculateCostMicros(uso.inputTokens, 0, precoDeEntrada, 0),
        inputPricePerMillionMicros: precoDeEntrada,
        outputPricePerMillionMicros: 0,
        resolvedModelName: uso.model,
        latencyMs,
        bindingOrigin: null,
      });
    } catch (erro) {
      // Medição nunca derruba o que ela mede, e não falha calada (a régua
      // do RAG, RN-479..481): origem `infra` no log da api.
      this.logger.warn(
        `[infra] metering da duplicata semântica não gravado (sessão ${input.sessionId}): ` +
          `${erro instanceof Error ? erro.message : String(erro)}`,
      );
    }
  }

  private async narrar(
    input: VerificarDuplicataSemanticaInput,
    resultado: SemanticDuplicateCheck,
  ): Promise<void> {
    const evento =
      resultado.status === 'warned'
        ? {
            type: 'backlog.semantic_duplicate_warned',
            payload: {
              kind: input.kind,
              itemId: input.itemId,
              title: input.title,
              similarToId: resultado.similarTo.id,
              similarToTitle: resultado.similarTo.title,
              similarity: resultado.similarity,
              threshold: resultado.threshold,
            },
          }
        : resultado.status === 'skipped'
          ? {
              type: 'backlog.semantic_duplicate_check_skipped',
              payload: {
                kind: input.kind,
                itemId: input.itemId,
                title: input.title,
                reason: resultado.reason,
              },
            }
          : null;
    if (!evento) return;

    try {
      await this.appendEvent.execute(input.projectId, input.sessionId, {
        ...evento,
        actor: ATOR_DA_DUPLICATA_SEMANTICA,
      });
    } catch (erro) {
      this.logger.warn(
        `[infra] ${evento.type} não gravado (sessão ${input.sessionId}): ` +
          `${erro instanceof Error ? erro.message : String(erro)}`,
      );
    }
  }
}

/** Texto que um modelo lê: três casas bastam e não fingem precisão. */
function arredondar(n: number): number {
  return Math.round(n * 1000) / 1000;
}

class TetoDeTempoEstourado extends Error {}

function comTeto<T>(promessa: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const teto = new Promise<never>((_, rejeitar) => {
    timer = setTimeout(() => rejeitar(new TetoDeTempoEstourado()), ms);
  });
  return Promise.race([promessa, teto]).finally(() => clearTimeout(timer));
}

/**
 * A frase que vai ao MODELO no resultado da ferramenta (`warned`/`skipped`).
 * Uma fonte só, para a história e para a regra — o engine só repassa.
 */
export function fraseParaOAgente(
  kind: TipoDeItem,
  resultado: SemanticDuplicateCheck,
): string | null {
  const oQue = kind === 'story' ? 'história' : 'regra de negócio';
  switch (resultado.status) {
    case 'warned':
      return (
        `AVISO (não é recusa): esta ${oQue} parece duplicar "${resultado.similarTo.title}" ` +
        `(${resultado.similarTo.id}), similaridade ${resultado.similarity} ≥ limiar ${resultado.threshold}. ` +
        `Se for o mesmo assunto, refine a existente em vez de manter as duas; se não for, siga.`
      );
    case 'skipped':
      return `A checagem de duplicata semântica foi PULADA: ${resultado.reason}.`;
    case 'clean':
      return resultado.compared < resultado.total
        ? `Duplicata semântica: nenhuma acima do limiar entre as ${resultado.compared} mais recentes de ${resultado.total}.`
        : null;
    default:
      return null;
  }
}
