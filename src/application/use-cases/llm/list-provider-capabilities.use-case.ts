import { Injectable } from '@nestjs/common';
import type { LLMProviderCapabilities, LLMProviderName } from '@brabo/shared';
import { LLMProviderRegistry } from '../../ports/llm-provider-registry.port';
import { LLM_PROVIDER_NAMES } from '../../../domain/llm/llm-provider-names';

export interface CapabilitiesDoProvider {
  provider: LLMProviderName;
  capabilities: LLMProviderCapabilities;
}

/**
 * As capabilities de PROVIDER dos nove, lidas das MESMAS instâncias que servem
 * as chamadas (ADR 0166, ponto 6). A tela precisa saber se o provider de um
 * modelo aceita critério de roteamento antes de oferecer a opção, e ler de
 * qualquer outro lugar seria a segunda fonte que um dia diverge do adapter.
 *
 * Fato do código desta instalação, igual para todo mundo — por isso não pende
 * de workspace nem de papel.
 */
@Injectable()
export class ListProviderCapabilitiesUseCase {
  constructor(private readonly llmProviders: LLMProviderRegistry) {}

  execute(): CapabilitiesDoProvider[] {
    return LLM_PROVIDER_NAMES.map((provider) => {
      const c = this.llmProviders.get(provider).capabilities;
      // Cópia campo a campo: o objeto do provider é a declaração dele, e a
      // resposta não deve carregar nada que o tipo não prometa.
      return {
        provider,
        capabilities: {
          streaming: c.streaming,
          toolCalling: c.toolCalling,
          listModels: c.listModels,
          embeddings: c.embeddings,
          routingPreference: c.routingPreference,
        },
      };
    });
  }
}
