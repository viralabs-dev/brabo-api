import { Injectable, NotFoundException } from '@nestjs/common';
import { ModelBindingRepository } from '../../ports/model-binding-repository.port';
import type { ModelBindingScope } from '../../../domain/llm/model-binding-scope';
import { assertScopeIdBemFormado } from '../../../domain/llm/binding-scope-id';

/**
 * Volta a herdar: apaga o binding de um escopo (ADR 0064, RN-102).
 *
 * A alternativa — gravar no agente o modelo que a área decidiu — pareceria
 * idêntica na tela e não é: a herança viraria CÓPIA, e a próxima mudança da
 * área deixaria esse agente para trás sem ninguém notar. Herdar é não ter
 * decisão própria, então desfazer a divergência é remover a linha.
 *
 * Escopo sem binding é 404 e não 204: "apaguei o que não existia" e "apaguei"
 * são respostas diferentes para a mesma tela, e a segunda esconderia um `agentSlug`
 * digitado errado.
 */
@Injectable()
export class ClearModelBindingUseCase {
  constructor(private readonly bindings: ModelBindingRepository) {}

  async execute(scope: ModelBindingScope, scopeId: string): Promise<void> {
    assertScopeIdBemFormado(scope, scopeId);

    const apagou = await this.bindings.remove(scope, scopeId);
    if (!apagou) {
      throw new NotFoundException(
        `Não há binding de ${scope} para apagar — este escopo já herda.`,
      );
    }
  }
}
