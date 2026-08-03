import { Injectable, Logger } from '@nestjs/common';
import type { LLMProviderName, ModeloDoCatalogo } from '@brabo/shared';
import { LLM_PROVIDER_NAMES } from '../../../domain/llm/llm-provider-names';
import { ModelRepository } from '../../ports/model-repository.port';
import { ModelPriceChangeRepository } from '../../ports/model-price-change-repository.port';
import { UnitOfWork } from '../../ports/unit-of-work.port';
import { UserCredentialRepository } from '../../ports/user-credential-repository.port';
import { EncryptionService } from '../../ports/encryption.port';
import { LLMProviderRegistry } from '../../ports/llm-provider-registry.port';
import { LLMProviderError } from '../../../domain/llm/llm-provider-errors';
import type { Model } from '../../../domain/llm/model.entity';

/** Por que um provider não foi sincronizado — nunca "falhou", sem mais. */
export type MotivoDoPulo =
  /** O provider não declara `capabilities.listModels`. */
  | 'sem_capability'
  /** Ninguém cadastrou credencial desse provider. */
  | 'sem_credencial'
  /** Chamou e o provider recusou ou não respondeu. */
  | 'falha';

export interface ResultadoPorProvider {
  provider: LLMProviderName;
  descobertos: number;
  reencontrados: number;
  indisponibilizados: number;
  pulado?: MotivoDoPulo;
  /**
   * A ORIGEM da falha, no vocabulário do ADR 0020 — `infra` quando não se
   * chegou a falar com o provider, `modelo` quando ele respondeu recusando.
   * Sem isto o operador diagnosticaria por eliminação, que é a lição que a
   * convenção do projeto proíbe repetir.
   */
  origemDaFalha?: 'infra' | 'modelo';
  detalhe?: string;
}

export interface SyncModelCatalogResult {
  porProvider: ResultadoPorProvider[];
}

/**
 * Sincroniza o catálogo REMOTO de cada provider com a tabela `models`
 * (Fase 9c, RN-043).
 *
 * ## As três regras da reconciliação
 *
 * 1. **Modelo novo entra INATIVO.** Um catálogo tem centenas de linhas;
 *    despejá-las ativas no seletor tornaria a escolha impossível e ligaria
 *    modelo caro sem ninguém decidir. Ativar é curadoria do owner.
 * 2. **Modelo que sumiu vira `unavailable`, nunca é deletado.** `model_bindings`
 *    e `token_usage` apontam para a linha; apagá-la levaria junto o histórico
 *    de custo. Quem lida com o binding órfão é a cascata do `resolveBinding`.
 * 3. **Modelo que voltou fica `available` com o `is_active` INTOCADO.** A
 *    escolha do owner sobrevive a uma ausência temporária do provider.
 *
 * ## Por que uma falha não indisponibiliza nada
 *
 * Um 401 ou um socket recusado significa "não sei o que tem lá", não "não tem
 * nada lá". Marcar o catálogo inteiro como sumido por causa de uma chave
 * revogada derrubaria todos os bindings do provider de uma vez. Provider que
 * falha é PULADO, com a origem registrada.
 *
 * ## As duas regras de PREÇO (RN-044)
 *
 * 4. **`manual_pricing` vence o catálogo remoto.** É o que o `schema.ts` sempre
 *    disse ("quem sincroniza preço NÃO pode sobrescrever uma linha marcada
 *    aqui sem decisão explícita") e o que o código não fazia: o remoto ganhava
 *    sempre que trouxesse preço. Quem digitou um número da doc do provider —
 *    ou corrigiu um errado — via o sync seguinte desfazer a correção.
 * 5. **Toda troca de preço deixa linha em `model_price_changes`.** A origem
 *    `sync` existe no domínio desde a Fase 9c e nenhuma escrita a produzia: o
 *    sync trocava preço por fora do caminho auditado. A auditoria guarda o par
 *    antes/depois justamente para provar que nenhuma escrita escapou — e uma
 *    escapava.
 */
@Injectable()
export class SyncModelCatalogUseCase {
  private readonly logger = new Logger(SyncModelCatalogUseCase.name);

  constructor(
    private readonly models: ModelRepository,
    private readonly credentials: UserCredentialRepository,
    private readonly encryption: EncryptionService,
    private readonly providers: LLMProviderRegistry,
    private readonly priceChanges: ModelPriceChangeRepository,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  async execute(): Promise<SyncModelCatalogResult> {
    const porProvider: ResultadoPorProvider[] = [];

    for (const nome of LLM_PROVIDER_NAMES) {
      porProvider.push(await this.sincronizarProvider(nome));
    }

    return { porProvider };
  }

  private async sincronizarProvider(
    nome: LLMProviderName,
  ): Promise<ResultadoPorProvider> {
    const vazio = {
      provider: nome,
      descobertos: 0,
      reencontrados: 0,
      indisponibilizados: 0,
    };

    const provider = this.providers.get(nome);
    if (!provider.capabilities.listModels || !provider.listModels) {
      return { ...vazio, pulado: 'sem_capability' };
    }

    // A closure é obrigatória: `listModels` é método de protótipo e usa `this`
    // para ler a config e as capabilities — passá-lo solto o perderia.
    const listar = (apiKey?: string): Promise<ModeloDoCatalogo[]> =>
      provider.listModels!(apiKey);

    let remotos: ModeloDoCatalogo[];
    try {
      remotos = await this.listarComAlgumaCredencial(nome, listar);
    } catch (erro) {
      if (erro instanceof SemCredencialError) {
        return { ...vazio, pulado: 'sem_credencial' };
      }
      const origemDaFalha =
        erro instanceof LLMProviderError &&
        (erro.code === 'connection' || erro.code === 'timeout')
          ? 'infra'
          : 'modelo';
      this.logger.warn(
        `sync de catálogo de ${nome} falhou (origem: ${origemDaFalha}): ${(erro as Error).message}`,
      );
      return {
        ...vazio,
        pulado: 'falha',
        origemDaFalha,
        detalhe: (erro as Error).message,
      };
    }

    return this.reconciliar(nome, remotos);
  }

  /**
   * O catálogo é público para quem tem QUALQUER chave válida do provider, e o
   * job periódico não roda em nome de ninguém. Tenta as credenciais na ordem e
   * para na primeira que responde — uma chave revogada no meio do caminho não
   * pode fazer o sync inteiro parecer indisponibilidade do provider.
   */
  private async listarComAlgumaCredencial(
    nome: LLMProviderName,
    listar: (apiKey?: string) => Promise<ModeloDoCatalogo[]>,
  ): Promise<ModeloDoCatalogo[]> {
    // O Ollama é local e não tem chave; o registro de credenciais nem o
    // contempla. Chamar sem `apiKey` é o caminho certo para ele.
    if (nome === 'ollama') return listar();

    const segredos = await this.credentials.listSecretsByProvider(nome);
    if (segredos.length === 0) throw new SemCredencialError();

    let ultimoErro: unknown;
    for (const segredo of segredos) {
      try {
        return await listar(this.encryption.decrypt(segredo));
      } catch (erro) {
        ultimoErro = erro;
      }
    }
    throw ultimoErro;
  }

  private async reconciliar(
    nome: LLMProviderName,
    remotos: ModeloDoCatalogo[],
  ): Promise<ResultadoPorProvider> {
    const locais = await this.models.listByProvider(nome);
    const porNome = new Map<string, Model>(locais.map((m) => [m.name, m]));
    const agora = new Date();

    let descobertos = 0;
    let reencontrados = 0;

    for (const remoto of remotos) {
      const local = porNome.get(remoto.name);
      if (!local) descobertos++;
      else if (local.availability === 'unavailable') reencontrados++;

      const preco = this.resolverPreco(remoto, local);

      const entrada = {
        provider: nome,
        name: remoto.name,
        displayName: remoto.displayName ?? local?.displayName ?? remoto.name,
        inputPricePerMillionMicros: preco.input,
        outputPricePerMillionMicros: preco.output,
        contextWindow: remoto.contextLength ?? local?.contextWindow ?? null,
        supportsToolCalling:
          remoto.supportsToolCalling ?? local?.supportsToolCalling ?? false,
        supportsStreaming: local?.supportsStreaming ?? true,
        supportsVision: local?.supportsVision ?? false,
        manualPricing: preco.manual,
        // Só no INSERT: o `set` do upsert não toca em `is_active` de propósito.
        isActive: local?.isActive ?? false,
        availability: 'available' as const,
        lastSeenAt: agora,
      };

      const trocouPreco =
        local !== undefined &&
        (local.inputPricePerMillionMicros !== preco.input ||
          local.outputPricePerMillionMicros !== preco.output);

      if (!trocouPreco) {
        // O caminho comum de um catálogo de centenas de linhas: nada de preço
        // mudou, e abrir transação por modelo só para não escrever nada seria
        // custo puro.
        await this.models.upsertByProviderAndName(entrada);
        continue;
      }

      await this.unitOfWork.runInTransaction(async () => {
        const linha = await this.models.upsertByProviderAndName(entrada);
        // MESMA transação que a escrita do preço, como no
        // `UpdateModelPricingUseCase`: preço trocado sem linha de auditoria é
        // o buraco que a RN-044 fecha, e commitar um sem o outro reabre.
        await this.priceChanges.record({
          modelId: linha.id,
          inputBeforeMicros: local.inputPricePerMillionMicros,
          inputAfterMicros: preco.input,
          outputBeforeMicros: local.outputPricePerMillionMicros,
          outputAfterMicros: preco.output,
          source: 'sync',
          // `null` porque não há pessoa por trás de um sync.
          changedBy: null,
        });
      });
    }

    const vistos = new Set(remotos.map((m) => m.name));
    const sumiram = locais.filter(
      (m) => !vistos.has(m.name) && m.availability === 'available',
    );
    await this.models.setAvailability(
      sumiram.map((m) => m.id),
      'unavailable',
    );

    return {
      provider: nome,
      descobertos,
      reencontrados,
      indisponibilizados: sumiram.length,
    };
  }

  /**
   * Qual preço fica gravado, e de quem ele é.
   *
   * Três situações, e cada uma tem um dono diferente:
   *
   * - **Linha `manual_pricing`**: o número é de quem digitou, e o catálogo
   *   remoto não encosta nele — nem quando traz preço. Era exatamente aqui que
   *   o sync desfazia correção humana.
   * - **Catálogo sem preço**: o que já está gravado permanece. Zerar faria toda
   *   chamada do modelo parecer de graça e o teto de orçamento nunca disparar.
   * - **Catálogo com preço, linha não-manual**: o remoto manda, que é o
   *   propósito do sync.
   *
   * O `manual` de um modelo NOVO sai do catálogo, não de um default fixo:
   * descoberto COM preço, a origem é o sync e ele mantém a linha em dia;
   * descoberto SEM preço, a linha nasce esperando alguém digitar — e marcá-la
   * manual desde já protege esse número do primeiro catálogo que resolver
   * informar preço.
   */
  private resolverPreco(
    remoto: ModeloDoCatalogo,
    local: Model | undefined,
  ): { input: number; output: number; manual: boolean } {
    const manual =
      local?.manualPricing ?? remoto.inputPricePerMillionMicros === undefined;

    if (local && local.manualPricing) {
      return {
        input: local.inputPricePerMillionMicros,
        output: local.outputPricePerMillionMicros,
        manual,
      };
    }

    return {
      input:
        remoto.inputPricePerMillionMicros ??
        local?.inputPricePerMillionMicros ??
        0,
      output:
        remoto.outputPricePerMillionMicros ??
        local?.outputPricePerMillionMicros ??
        0,
      manual,
    };
  }
}

class SemCredencialError extends Error {}
