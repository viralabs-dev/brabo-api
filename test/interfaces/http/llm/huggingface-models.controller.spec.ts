import { describe, it, expect } from 'vitest';
import { Reflector } from '@nestjs/core';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { HuggingFaceModelsController } from '../../../../src/interfaces/http/llm/huggingface-models.controller';
import { REQUIRED_ROLE_KEY } from '../../../../src/interfaces/http/iam/require-role.decorator';
import { RequestModelPullDto } from '../../../../src/interfaces/http/llm/dto/request-model-pull.dto';

/**
 * Papel exigido nas quatro rotas — owner/maintainer, mesmo padrão de mutação
 * do resto do catálogo de LLM (`models.controller.ts`). `RolesGuard` já prova
 * a matriz de papéis em geral (`roles.guard.spec.ts`); este teste prova que
 * ESTE controller está anotado, o que é o que faz a matriz valer para ele.
 */
describe('HuggingFaceModelsController — papel exigido nas quatro rotas', () => {
  const reflector = new Reflector();

  it('GET .../huggingface/models exige maintainer', () => {
    expect(
      reflector.get(
        REQUIRED_ROLE_KEY,
        HuggingFaceModelsController.prototype.search,
      ),
    ).toBe('maintainer');
  });

  it('POST .../huggingface/pull-requests exige maintainer', () => {
    expect(
      reflector.get(
        REQUIRED_ROLE_KEY,
        HuggingFaceModelsController.prototype.createPullRequest,
      ),
    ).toBe('maintainer');
  });

  it('POST .../pull-requests/:id/confirm exige maintainer', () => {
    expect(
      reflector.get(
        REQUIRED_ROLE_KEY,
        HuggingFaceModelsController.prototype.confirm,
      ),
    ).toBe('maintainer');
  });

  it('GET .../pull-requests/:id exige maintainer', () => {
    expect(
      reflector.get(
        REQUIRED_ROLE_KEY,
        HuggingFaceModelsController.prototype.getStatus,
      ),
    ).toBe('maintainer');
  });
});

describe('RequestModelPullDto', () => {
  function erros(dto: object) {
    return validateSync(plainToInstance(RequestModelPullDto, dto) as object);
  }

  it('aceita repoId no formato publisher/modelo, sem estimatedSizeBytes', () => {
    expect(
      erros({ repoId: 'meta-llama/Llama-3.1-8B-Instruct-GGUF' }),
    ).toHaveLength(0);
  });

  it('aceita estimatedSizeBytes quando presente e positivo', () => {
    expect(
      erros({
        repoId: 'meta-llama/Llama-3.1-8B-Instruct-GGUF',
        estimatedSizeBytes: 4_900_000_000,
      }),
    ).toHaveLength(0);
  });

  it('recusa repoId ausente', () => {
    expect(erros({})).not.toHaveLength(0);
  });

  it('recusa estimatedSizeBytes negativo', () => {
    expect(
      erros({
        repoId: 'meta-llama/Llama-3.1-8B-Instruct-GGUF',
        estimatedSizeBytes: -5,
      }),
    ).not.toHaveLength(0);
  });
});
