import { describe, expect, it, vi } from 'vitest';
import type { ArgumentsHost } from '@nestjs/common';
import { LlmBindingErrorFilter } from '../../../../src/interfaces/http/shared/llm-binding-error.filter';
import { AliasDeRoteamentoLivreError } from '../../../../src/domain/llm/alias-de-roteamento-livre';
import { ModelNotBindableError } from '../../../../src/domain/llm/model-capabilities';
import type { Model } from '../../../../src/domain/llm/model.entity';

function fakeHost() {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  const host = {
    switchToHttp: () => ({ getResponse: () => ({ status }) }),
  } as unknown as ArgumentsHost;
  return { host, status, json };
}

/**
 * AT-271, RN-679: a recusa do alias `~` na curadoria chega à tela com CÓDIGO
 * próprio e os ids recusados — a tela casa pelo código, nunca pelo texto.
 */
describe('LlmBindingErrorFilter', () => {
  it('alias de roteamento livre vira 422 com `code` e `modelIds`', () => {
    const { host, status, json } = fakeHost();
    const erro = new AliasDeRoteamentoLivreError([
      { id: 'm-1', name: '~deepseek/deepseek-flash-latest' },
    ]);

    new LlmBindingErrorFilter().catch(erro, host);

    expect(status).toHaveBeenCalledWith(422);
    expect(json).toHaveBeenCalledWith({
      statusCode: 422,
      message: erro.message,
      error: 'Unprocessable Entity',
      code: 'alias_de_roteamento_livre',
      modelIds: ['m-1'],
    });
  });

  it('as outras recusas seguem SEM `code` (o corpo delas não muda)', () => {
    const { host, json } = fakeHost();
    const erro = new ModelNotBindableError(
      { displayName: 'X' } as Model,
      'inativo',
    );

    new LlmBindingErrorFilter().catch(erro, host);

    expect(json).toHaveBeenCalledWith({
      statusCode: 422,
      message: erro.message,
      error: 'Unprocessable Entity',
    });
  });
});
