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
import { ToolRouter } from '../../application/ports/tool-router.port';
import { JevToolRouter } from './jev-tool-router';

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
    // Fora do `LLMProviderRegistry` de propósito (ADR 0179): o Jev decide, não conversa.
    { provide: ToolRouter, useFactory: () => new JevToolRouter() },
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
    ToolRouter,
    // `pullModel` é específico do Ollama — não faz parte do contrato
    // `LLMProvider` (nenhum outro provider tem "puxar peso de modelo", e o
    // `LLMProviderRegistry` só sabe devolver o tipo genérico). Exportar a
    // classe concreta é o jeito de `ConfirmModelPullUseCase` chegar nela sem
    // forçar o contrato compartilhado a carregar um método que só um dos
    // nove providers implementa.
    OllamaProvider,
  ],
})
export class LlmInfrastructureModule {}
