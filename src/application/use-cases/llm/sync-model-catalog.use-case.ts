import { Injectable, Logger } from '@nestjs/common';
import {
  LLM_PROVIDER_NAMES,
  type LLMProviderName,
  type ModeloDoCatalogo,
} from '@brabo/shared';
import { ModelRepository } from '../../ports/model-repository.port';
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
 */
@Injectable()
export class SyncModelCatalogUseCase {
  private readonly logger = new Logger(SyncModelCatalogUseCase.name);

  constructor(
    private readonly models: ModelRepository,
    private readonly credentials: UserCredentialRepository,
    private readonly encryption: EncryptionService,
    private readonly providers: LLMProviderRegistry,
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

      await this.models.upsertByProviderAndName({
        provider: nome,
        name: remoto.name,
        displayName: remoto.displayName ?? local?.displayName ?? remoto.name,
        // Preço ausente no catálogo NÃO zera o que já está gravado — na Fase 9b
        // vários preços entraram digitados da doc (`manual_pricing`), e
        // sobrescrevê-los com 0 faria toda chamada parecer de graça.
        inputPricePerMillionMicros:
          remoto.inputPricePerMillionMicros ??
          local?.inputPricePerMillionMicros ??
          0,
        outputPricePerMillionMicros:
          remoto.outputPricePerMillionMicros ??
          local?.outputPricePerMillionMicros ??
          0,
        contextWindow: remoto.contextLength ?? local?.contextWindow ?? null,
        supportsToolCalling:
          remoto.supportsToolCalling ?? local?.supportsToolCalling ?? false,
        supportsStreaming: local?.supportsStreaming ?? true,
        supportsVision: local?.supportsVision ?? false,
        manualPricing: local?.manualPricing ?? true,
        // Só no INSERT: o `set` do upsert não toca em `is_active` de propósito.
        isActive: local?.isActive ?? false,
        availability: 'available',
        lastSeenAt: agora,
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
}

class SemCredencialError extends Error {}
