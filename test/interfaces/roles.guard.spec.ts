import { describe, it, expect, vi } from 'vitest';
import { Reflector } from '@nestjs/core';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { RolesGuard } from '../../src/interfaces/http/iam/roles.guard';
import { ROLE_ORDER, type Role } from '../../src/domain/iam/role';
import type { ResolveEffectiveRoleUseCase } from '../../src/application/use-cases/iam/resolve-effective-role.use-case';

/**
 * A matriz de permissões, fixada em teste (Fase 7a — o corte).
 *
 * ## Por que este teste nasceu agora
 *
 * A troca do emissor de token mexe no único ponto de que todo o RBAC depende:
 * quem popula `request.user`. Antes do corte não havia spec nenhum para o
 * `RolesGuard` — a cobertura era indireta, pelo `route-surface.spec.ts` (que
 * afirma sobre a ANOTAÇÃO de cada rota) e pelo
 * `resolve-effective-role.use-case.spec.ts` (que afirma sobre a resolução de
 * papel no banco). O pedaço do meio, "dado um papel efetivo e um papel
 * exigido, passa ou não", não tinha nada.
 *
 * ## O que ele prova sobre o corte
 *
 * Que a decisão de papel é função APENAS de `(papelEfetivo, papelExigido)` e
 * de `request.user.id` — nenhum claim de token entra na conta. É por isso que
 * a matriz atravessa a troca de emissor inalterada, e é isso que o critério de
 * aceite "matriz RBAC idêntica" quer dizer na prática.
 */

function contexto(opcoes: {
  papelExigido?: Role;
  userId?: string;
  params?: Record<string, string>;
}): ExecutionContext {
  const request = {
    user: opcoes.userId ? { id: opcoes.userId } : undefined,
    params: opcoes.params ?? {},
  };

  return {
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function montar(opcoes: {
  papelExigido?: Role;
  papelDeProjeto?: Role | null;
  papelDeWorkspace?: Role | null;
}) {
  const reflector = {
    getAllAndOverride: vi.fn().mockReturnValue(opcoes.papelExigido),
  } as unknown as Reflector;

  const resolve = {
    forProject: vi.fn().mockResolvedValue(opcoes.papelDeProjeto ?? null),
    forWorkspace: vi.fn().mockResolvedValue(opcoes.papelDeWorkspace ?? null),
  } as unknown as ResolveEffectiveRoleUseCase;

  return { guard: new RolesGuard(reflector, resolve), resolve };
}

describe('RolesGuard — a matriz de papéis', () => {
  it('rota sem @RequireRole passa sem nem olhar o usuário', async () => {
    const { guard, resolve } = montar({});

    await expect(guard.canActivate(contexto({}))).resolves.toBe(true);
    expect(resolve.forProject).not.toHaveBeenCalled();
  });

  // A matriz inteira, 4x4. Escrita por extensão de propósito: uma tabela
  // explícita é o artefato que se compara entre duas versões do sistema, que é
  // exatamente o que o critério de aceite deste corte pede.
  const esperado: Record<Role, Record<Role, boolean>> = {
    viewer: { viewer: true, developer: false, maintainer: false, owner: false },
    developer: {
      viewer: true,
      developer: true,
      maintainer: false,
      owner: false,
    },
    maintainer: {
      viewer: true,
      developer: true,
      maintainer: true,
      owner: false,
    },
    owner: { viewer: true, developer: true, maintainer: true, owner: true },
  };

  for (const efetivo of ROLE_ORDER) {
    for (const exigido of ROLE_ORDER) {
      const passa = esperado[efetivo][exigido];

      it(`papel ${efetivo} ${passa ? 'ATENDE' : 'não atende'} a exigência de ${exigido}`, async () => {
        const { guard } = montar({
          papelExigido: exigido,
          papelDeProjeto: efetivo,
        });
        const ctx = contexto({ userId: 'u-1', params: { projectId: 'p-1' } });

        if (passa) {
          await expect(guard.canActivate(ctx)).resolves.toBe(true);
        } else {
          await expect(guard.canActivate(ctx)).rejects.toThrow(
            ForbiddenException,
          );
        }
      });
    }
  }

  it('sem papel nenhum, recusa mesmo a exigência mais baixa', async () => {
    const { guard } = montar({ papelExigido: 'viewer', papelDeProjeto: null });

    await expect(
      guard.canActivate(
        contexto({ userId: 'u-1', params: { projectId: 'p-1' } }),
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('sem request.user, recusa — não confunde ausência com papel', async () => {
    // O tipo diz que `user` sempre existe; em runtime não existe em rota
    // pública. Se o guard tratasse ausência como "sem papel a verificar", uma
    // rota com @RequireRole que escapasse do JwtAuthGuard passaria livre.
    const { guard } = montar({
      papelExigido: 'viewer',
      papelDeProjeto: 'owner',
    });

    await expect(
      guard.canActivate(contexto({ params: { projectId: 'p-1' } })),
    ).rejects.toThrow(ForbiddenException);
  });

  describe('de onde o papel é resolvido', () => {
    it('com :projectId, resolve pelo projeto', async () => {
      const { guard, resolve } = montar({
        papelExigido: 'viewer',
        papelDeProjeto: 'owner',
      });

      await guard.canActivate(
        contexto({ userId: 'u-1', params: { projectId: 'p-1' } }),
      );

      expect(resolve.forProject).toHaveBeenCalledWith('u-1', 'p-1');
      expect(resolve.forWorkspace).not.toHaveBeenCalled();
    });

    it(':projectId tem precedência sobre :workspaceId', async () => {
      // Rotas aninhadas carregam os dois. O papel de projeto é o mais
      // específico e já cai para o do workspace lá dentro do use case — olhar o
      // workspace aqui pularia essa cadeia.
      const { guard, resolve } = montar({
        papelExigido: 'viewer',
        papelDeProjeto: 'owner',
      });

      await guard.canActivate(
        contexto({
          userId: 'u-1',
          params: { projectId: 'p-1', workspaceId: 'w-1' },
        }),
      );

      expect(resolve.forProject).toHaveBeenCalled();
      expect(resolve.forWorkspace).not.toHaveBeenCalled();
    });

    it('só com :workspaceId, resolve pelo workspace', async () => {
      const { guard, resolve } = montar({
        papelExigido: 'viewer',
        papelDeWorkspace: 'developer',
      });

      await guard.canActivate(
        contexto({ userId: 'u-1', params: { workspaceId: 'w-1' } }),
      );

      expect(resolve.forWorkspace).toHaveBeenCalledWith('u-1', 'w-1');
    });

    it('sem parâmetro de escopo, recusa', async () => {
      // Não há como resolver papel sem saber "papel em quê". Passar livre aqui
      // transformaria uma rota mal declarada em rota aberta.
      const { guard } = montar({ papelExigido: 'viewer' });

      await expect(
        guard.canActivate(contexto({ userId: 'u-1' })),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  it('a decisão usa só o id do usuário — nenhum dado do token', async () => {
    // O que faz a matriz sobreviver à troca de emissor: o guard nunca lê
    // e-mail, nome, sub, nem claim nenhuma. Se um dia ler, este teste continua
    // passando — mas a chamada abaixo mostra qual é o contrato de verdade.
    const { guard, resolve } = montar({
      papelExigido: 'developer',
      papelDeProjeto: 'maintainer',
    });

    await guard.canActivate(
      contexto({ userId: 'u-42', params: { projectId: 'p-9' } }),
    );

    expect(resolve.forProject).toHaveBeenCalledWith('u-42', 'p-9');
    expect(resolve.forProject).toHaveBeenCalledTimes(1);
  });
});
