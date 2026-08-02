import { Module } from '@nestjs/common';
import { EncryptionService } from '../../application/ports/encryption.port';
import { TokenEstimator } from '../../application/ports/token-estimator.port';
import { LLMProviderRegistry } from '../../application/ports/llm-provider-registry.port';
import { LLMCredentialConnectionTester } from '../../application/ports/llm-credential-connection-tester.port';
import { EnvelopeEncryptionService } from '../security/envelope-encryption.service';
import { GptTokenizerEstimator } from '../tokenization/gpt-tokenizer-estimator';
import { OllamaProvider } from './ollama-provider';
import { AnthropicProvider } from './anthropic-provider';
import { OpenAIProvider } from './openai-provider';
import { OpenRouterProvider } from './openrouter-provider';
import { NvidiaNimProvider } from './nvidia-nim-provider';
import { TogetherProvider } from './together-provider';
import { DeepInfraProvider } from './deepinfra-provider';
import { BitdeerProvider } from './bitdeer-provider';
import { VultrProvider } from './vultr-provider';
import { LLMProviderRegistryImpl } from './llm-provider-registry';
import { LLMCredentialConnectionTesterImpl } from './llm-credential-connection-tester';

@Module({
  providers: [
    OllamaProvider,
    AnthropicProvider,
    OpenAIProvider,
    OpenRouterProvider,
    NvidiaNimProvider,
    TogetherProvider,
    DeepInfraProvider,
    BitdeerProvider,
    VultrProvider,
    { provide: LLMProviderRegistry, useClass: LLMProviderRegistryImpl },
    { provide: EncryptionService, useClass: EnvelopeEncryptionService },
    { provide: TokenEstimator, useClass: GptTokenizerEstimator },
    {
      provide: LLMCredentialConnectionTester,
      useClass: LLMCredentialConnectionTesterImpl,
    },
  ],
  exports: [
    LLMProviderRegistry,
    EncryptionService,
    TokenEstimator,
    LLMCredentialConnectionTester,
  ],
})
export class LlmInfrastructureModule {}
