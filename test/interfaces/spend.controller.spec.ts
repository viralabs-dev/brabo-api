import { describe, expect, it } from 'vitest';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { SpendController } from '../../src/interfaces/http/llm/spend.controller';
import { REQUIRED_ROLE_KEY } from '../../src/interfaces/http/iam/require-role.decorator';
import type { GetWorkspaceSpendReportUseCase } from '../../src/application/use-cases/llm/get-workspace-spend-report.use-case';
import type { GetMySpendUseCase } from '../../src/application/use-cases/llm/get-my-spend.use-case';
import type { User } from '../../src/domain/iam/user.entity';

/**
 * A contenção de privacidade do ADR 0076, vista da BORDA.
 *
 * O eixo de provider voltou a existir (RN-186) e mora só no relatório do owner.
 * O que impede o membro de alcançá-lo são duas barreiras independentes, e esta
 * suíte cobre a primeira: **a rota dele não tem onde escrever uma dimensão**.
 * A segunda — o tipo do port recusando `provider` com escopo de ator (RN-187) —
 * é verificada pelo compilador, em
 * `test/application/use-cases/llm/spend-audiencias.use-case.spec.ts`.
 *
 * Este teste lê os decoradores de parâmetro que o Nest registrou, e não o corpo
 * do método: é exatamente o que o framework usa para preencher os argumentos, e
 * portanto o inventário completo do que a rota aceita da requisição.
 */
type ParamRegistrado = { index: number; data?: unknown };

function parametrosDaRota(metodo: 'getWorkspaceSpendReport' | 'getMySpend') {
  const meta = Reflect.getMetadata(
    ROUTE_ARGS_METADATA,
    SpendController,
    metodo,
  ) as Record<string, ParamRegistrado>;

  // A chave é `${tipoDoParametro}:${indice}`; o `data` é o nome pedido
  // (`@Query('dias')` → `'dias'`).
  return Object.entries(meta).map(([chave, valor]) => ({
    tipo: chave.split(':')[0],
    nome: valor.data,
  }));
}

describe('SpendController — a rota do membro não tem eixo de provider', () => {
  it('aceita `dias` e mais nada da query: `?dimensao=provider` não chega a lugar nenhum', () => {
    const nomesDaQuery = parametrosDaRota('getMySpend')
      .filter((p) => typeof p.nome === 'string')
      .map((p) => p.nome);

    // Só dois nomes: o `projectId` do caminho e a janela. Não há terceiro, e é
    // por isso que uma query inventada é descartada pelo Nest antes de o
    // handler existir — não por um `if` que valida e ignora.
    expect(new Set(nomesDaQuery)).toEqual(new Set(['projectId', 'dias']));
    expect(nomesDaQuery).not.toContain('dimensao');
    expect(nomesDaQuery).not.toContain('provider');
  });

  it('o relatório com o eixo de provider exige `owner`; o do membro, `viewer`', () => {
    const papel = (metodo: keyof SpendController) =>
      Reflect.getMetadata(REQUIRED_ROLE_KEY, SpendController.prototype[metodo]);

    // A régua da RN-060: quem vê credencial é quem paga a conta.
    expect(papel('getWorkspaceSpendReport')).toBe('owner');
    expect(papel('getMySpend')).toBe('viewer');
  });

  it('o ator do relatório do membro sai do token, nunca do que veio na requisição', async () => {
    const pedidos: unknown[][] = [];
    const controller = new SpendController(
      {} as GetWorkspaceSpendReportUseCase,
      {
        execute: (...args: unknown[]) => {
          pedidos.push(args);
          return Promise.resolve(null);
        },
      } as unknown as GetMySpendUseCase,
    );

    await controller.getMySpend(
      'projeto-1',
      { id: 'usuario-do-token' } as User,
      '9999',
    );

    // Projeto, ator e janela — nesta ordem, e nada além. A janela ainda passa
    // pelo teto de 180 dias, que é de onde vem o `180` no lugar do `9999`.
    expect(pedidos).toEqual([['projeto-1', 'usuario-do-token', 180]]);
  });
});
