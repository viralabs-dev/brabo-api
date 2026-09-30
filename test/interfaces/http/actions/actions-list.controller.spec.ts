import { describe, it, expect, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { ActionsController } from '../../../../src/interfaces/http/actions/actions.controller';
import type { ListProposedActionsUseCase } from '../../../../src/application/use-cases/actions/list-proposed-actions.use-case';

/**
 * AT-296, RN-637 — `GET .../sessions/:sessionId/actions` com `latest` e
 * `status`. O repositório é provado contra Postgres em
 * `proposed-action-latest.repository.spec.ts`; aqui, só o que o controller
 * traduz da query string.
 */
function montar() {
  const execute = vi.fn().mockResolvedValue({ items: [], nextCursor: null });
  const listar = { execute } as unknown as ListProposedActionsUseCase;
  const controller = new ActionsController(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    listar,
  );
  return { controller, execute };
}

describe('ActionsController.list — cauda e pendentes (AT-296)', () => {
  it('repassa `latest=true` e `status=pending` ao caso de uso', async () => {
    const { controller, execute } = montar();

    await controller.list('p1', 's1', undefined, '200', 'true', 'pending');

    expect(execute).toHaveBeenCalledWith('p1', 's1', {
      afterSeq: undefined,
      limit: 200,
      latest: true,
      status: 'pending',
    });
  });

  it('sem os parâmetros novos, o contrato de antes fica igual', async () => {
    const { controller, execute } = montar();

    await controller.list('p1', 's1', '6', '50');

    expect(execute).toHaveBeenCalledWith('p1', 's1', {
      afterSeq: 6,
      limit: 50,
      latest: false,
      status: undefined,
    });
  });

  it('recusa com 400 um `status` que não seja `pending`, sem consultar', () => {
    const { controller, execute } = montar();

    expect(() =>
      controller.list('p1', 's1', undefined, undefined, undefined, 'approved'),
    ).toThrow(BadRequestException);
    expect(execute).not.toHaveBeenCalled();
  });
});
