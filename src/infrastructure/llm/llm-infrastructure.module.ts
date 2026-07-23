import { Module } from '@nestjs/common';
import { EncryptionService } from '../../application/ports/encryption.port';
import { TokenEstimator } from '../../application/ports/token-estimator.port';
import { LLMProviderRegistry } from '../../application/ports/llm-provider-registry.port';
import { EnvelopeEncryptionService } from '../security/envelope-encryption.service';
import { GptTokenizerEstimator } from '../tokenization/gpt-tokenizer-estimator';
import { OllamaProvider } from './ollama-provider';
import { AnthropicProvider } from './anthropic-provider';
import { OpenAIProvider } from './openai-provider';
import { LLMProviderRegistryImpl } from './llm-provider-registry';

@Module({
  providers: [
    OllamaProvider,
    AnthropicProvider,
    OpenAIProvider,
    { provide: LLMProviderRegistry, useClass: LLMProviderRegistryImpl },
    { provide: EncryptionService, useClass: EnvelopeEncryptionService },
    { provide: TokenEstimator, useClass: GptTokenizerEstimator },
  ],
  exports: [LLMProviderRegistry, EncryptionService, TokenEstimator],
})
export class LlmInfrastructureModule {}
