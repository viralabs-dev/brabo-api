import { describe, it, expect, vi } from 'vitest';
import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { PatAuthGuard } from '../../src/interfaces/http/auth/pat-auth.guard';
import { hashDeToken } from '../../src/infrastructure/security/auth-key-material';
import type { PersonalAccessTokenRepository } from '../../src/application/ports/personal-access-token-repository.port';
import type { UserRepository } from '../../src/application/ports/user-repository.port';
import type { ResolveEffectiveRoleUseCase } from '../../src/application/use-cases/iam/resolve-effective-role.use-case';
import type { Role } from '../../src/domain/iam/role';
import type { User } from '../../src/domain/iam/user.entity';

/**
 * O guard que estabelece `request.user` a partir de um Personal Access
 * Token (ADR 0105) — a peça de segurança central da Onda 2. Testado com
 * fakes, não banco real: a validação de verdade (colapsar
 * inexistente/revogado/expirado) já é coberta em
 * `personal-access-token.repository.spec.ts`; aqui o que importa é o
 * CONTRATO do guard — o que ele aceita, recusa, e em que ordem.
 *
 * Desde RN-439, este guard também aplica `@RequireRole` — ver o docblock
 * do próprio `PatAuthGuard` pro porquê (`RolesGuard`, guard GLOBAL, roda
 * ANTES do guard LOCAL desta rota e por isso não podia ser quem autoriza).
 */
function contexto(opcoes: {
  authorization?: string;
  projectId?: string;
  papelExigido?: Role;
}) {
  const request = {
    headers: opcoes.authorization
      ? { authorization: opcoes.authorization }
      : {},
    params: { projectId: opcoes.projectId ?? 'proj-1' },
  } as {
    headers: Record<string, string>;
    params: Record<string, string>;
    user?: unknown;
    effectiveRole?: unknown;
  };

  const ctx = {
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;

  return { ctx, request };
}

const USUARIO: User = {
  id: 'user-1',
  email: 'runner@brabo.dev',
} as User;

function guard(opcoes: {
  validado?: { id: string; userId: string; projectId: string } | null;
  usuario?: User | null;
  papelExigido?: Role;
  papelEfetivo?: Role | null;
}): { guard: PatAuthGuard; resolveEffectiveRole: ResolveEffectiveRoleUseCase } {
  const tokens = {
    validarEUsar: vi.fn(() => Promise.resolve(opcoes.validado ?? null)),
  } as unknown as PersonalAccessTokenRepository;
  const users = {
    findById: vi.fn(() =>
      Promise.resolve('usuario' in opcoes ? opcoes.usuario : USUARIO),
    ),
  } as unknown as UserRepository;
  const reflector = {
    getAllAndOverride: vi.fn().mockReturnValue(opcoes.papelExigido),
  } as unknown as Reflector;
  const resolveEffectiveRole = {
    forProject: vi.fn().mockResolvedValue(opcoes.papelEfetivo ?? null),
  } as unknown as ResolveEffectiveRoleUseCase;

  return {
    guard: new PatAuthGuard(tokens, users, reflector, resolveEffectiveRole),
    resolveEffectiveRole,
  };
}

describe('PatAuthGuard', () => {
  it('caminho feliz: popula request.user a partir do dono do token', async () => {
    const { ctx, request } = contexto({
      authorization: 'Bearer brb_valido',
      projectId: 'proj-1',
    });
    const { guard: g } = guard({
      validado: { id: 'pat-1', userId: 'user-1', projectId: 'proj-1' },
    });

    await expect(g.canActivate(ctx)).resolves.toBe(true);
    expect((request.user as User).id).toBe('user-1');
  });

  it('valida contra o HASH do token, nunca o token bruto (RN-439)', async () => {
    // Achado na mesma correção da ordem de guards: `validarEUsar` compara
    // contra `token_hash` no banco — passar o bruto direto nunca batia com
    // nada, e o sintoma era 401 sempre, escondido atrás do 403 de
    // `RolesGuard` até este ficar corrigido.
    const { ctx } = contexto({
      authorization: 'Bearer brb_valido',
      projectId: 'proj-1',
    });
    const validarEUsar = vi.fn(() =>
      Promise.resolve({ id: 'pat-1', userId: 'user-1', projectId: 'proj-1' }),
    );
    const tokens = { validarEUsar } as unknown as PersonalAccessTokenRepository;
    const users = {
      findById: vi.fn(() => Promise.resolve(USUARIO)),
    } as unknown as UserRepository;
    const reflector = {
      getAllAndOverride: vi.fn().mockReturnValue(undefined),
    } as unknown as Reflector;
    const g = new PatAuthGuard(
      tokens,
      users,
      reflector,
      {} as ResolveEffectiveRoleUseCase,
    );

    await g.canActivate(ctx);

    expect(validarEUsar).toHaveBeenCalledWith(hashDeToken('brb_valido'));
    expect(validarEUsar).not.toHaveBeenCalledWith('brb_valido');
  });

  it('sem header de autorização: 401', async () => {
    const { ctx } = contexto({});
    await expect(guard({}).guard.canActivate(ctx)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('bearer que NÃO começa com brb_: 401 — nunca tenta dual-auth com JWT', async () => {
    const { ctx } = contexto({ authorization: 'Bearer um.jwt.qualquer' });
    const validarEUsar = vi.fn();
    const tokens = { validarEUsar } as unknown as PersonalAccessTokenRepository;
    const reflector = {
      getAllAndOverride: vi.fn(),
    } as unknown as Reflector;
    const g = new PatAuthGuard(
      tokens,
      {} as UserRepository,
      reflector,
      {} as ResolveEffectiveRoleUseCase,
    );

    await expect(g.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    // Nunca chega a consultar o repositório — recusado só pelo prefixo.
    expect(validarEUsar).not.toHaveBeenCalled();
  });

  it('esquema que não é Bearer: 401', async () => {
    const { ctx } = contexto({ authorization: 'Basic brb_valido' });
    await expect(guard({}).guard.canActivate(ctx)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('token inexistente/revogado/expirado (repositório devolve null): 401', async () => {
    const { ctx } = contexto({ authorization: 'Bearer brb_qualquer' });
    await expect(
      guard({ validado: null }).guard.canActivate(ctx),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('token válido mas escopado a OUTRO projeto: 403, não 401 — categoria diferente', async () => {
    const { ctx } = contexto({
      authorization: 'Bearer brb_valido',
      projectId: 'proj-alvo',
    });
    const { guard: g } = guard({
      validado: { id: 'pat-1', userId: 'user-1', projectId: 'proj-diferente' },
    });

    await expect(g.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('dono do token não existe mais: 401', async () => {
    const { ctx } = contexto({ authorization: 'Bearer brb_valido' });
    const { guard: g } = guard({
      validado: { id: 'pat-1', userId: 'user-sumiu', projectId: 'proj-1' },
      usuario: null,
    });

    await expect(g.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  describe('autorização por papel (RN-439)', () => {
    it('sem @RequireRole na rota: autentica e passa sem consultar papel', async () => {
      const { ctx, request } = contexto({
        authorization: 'Bearer brb_valido',
        projectId: 'proj-1',
      });
      const { guard: g, resolveEffectiveRole } = guard({
        validado: { id: 'pat-1', userId: 'user-1', projectId: 'proj-1' },
      });

      await expect(g.canActivate(ctx)).resolves.toBe(true);
      expect(resolveEffectiveRole.forProject).not.toHaveBeenCalled();
      expect(request.effectiveRole).toBeUndefined();
    });

    it('papel efetivo ATENDE a exigência (developer no projeto): passa e popula effectiveRole', async () => {
      const { ctx, request } = contexto({
        authorization: 'Bearer brb_valido',
        projectId: 'proj-1',
      });
      const { guard: g } = guard({
        validado: { id: 'pat-1', userId: 'user-1', projectId: 'proj-1' },
        papelExigido: 'developer',
        papelEfetivo: 'developer',
      });

      await expect(g.canActivate(ctx)).resolves.toBe(true);
      expect(request.effectiveRole).toBe('developer');
    });

    it('papel efetivo ACIMA da exigência (maintainer >= developer): passa', async () => {
      const { ctx } = contexto({
        authorization: 'Bearer brb_valido',
        projectId: 'proj-1',
      });
      const { guard: g } = guard({
        validado: { id: 'pat-1', userId: 'user-1', projectId: 'proj-1' },
        papelExigido: 'developer',
        papelEfetivo: 'maintainer',
      });

      await expect(g.canActivate(ctx)).resolves.toBe(true);
    });

    it('papel efetivo ABAIXO da exigência (viewer < developer): 403 "Papel insuficiente"', async () => {
      const { ctx } = contexto({
        authorization: 'Bearer brb_valido',
        projectId: 'proj-1',
      });
      const { guard: g } = guard({
        validado: { id: 'pat-1', userId: 'user-1', projectId: 'proj-1' },
        papelExigido: 'developer',
        papelEfetivo: 'viewer',
      });

      await expect(g.canActivate(ctx)).rejects.toThrow(
        new ForbiddenException('Papel insuficiente para esta ação'),
      );
    });

    it('sem NENHUM vínculo com o projeto (papel nulo): 403 "Papel insuficiente"', async () => {
      const { ctx } = contexto({
        authorization: 'Bearer brb_valido',
        projectId: 'proj-1',
      });
      const { guard: g } = guard({
        validado: { id: 'pat-1', userId: 'user-1', projectId: 'proj-1' },
        papelExigido: 'developer',
        papelEfetivo: null,
      });

      await expect(g.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    });
  });
});
