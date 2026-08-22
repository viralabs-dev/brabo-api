import { describe, it, expect, vi } from 'vitest';
import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { PatAuthGuard } from '../../src/interfaces/http/auth/pat-auth.guard';
import type { PersonalAccessTokenRepository } from '../../src/application/ports/personal-access-token-repository.port';
import type { UserRepository } from '../../src/application/ports/user-repository.port';
import type { User } from '../../src/domain/iam/user.entity';

/**
 * O guard que estabelece `request.user` a partir de um Personal Access
 * Token (ADR 0105) — a peça de segurança central da Onda 2. Testado com
 * fakes, não banco real: a validação de verdade (colapsar
 * inexistente/revogado/expirado) já é coberta em
 * `personal-access-token.repository.spec.ts`; aqui o que importa é o
 * CONTRATO do guard — o que ele aceita, recusa, e em que ordem.
 */
function contexto(opcoes: { authorization?: string; projectId?: string }) {
  const request = {
    headers: opcoes.authorization
      ? { authorization: opcoes.authorization }
      : {},
    params: { projectId: opcoes.projectId ?? 'proj-1' },
  } as {
    headers: Record<string, string>;
    params: Record<string, string>;
    user?: unknown;
  };

  const ctx = {
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
}): PatAuthGuard {
  const tokens = {
    validarEUsar: vi.fn(() => Promise.resolve(opcoes.validado ?? null)),
  } as unknown as PersonalAccessTokenRepository;
  const users = {
    findById: vi.fn(() =>
      Promise.resolve('usuario' in opcoes ? opcoes.usuario : USUARIO),
    ),
  } as unknown as UserRepository;

  return new PatAuthGuard(tokens, users);
}

describe('PatAuthGuard', () => {
  it('caminho feliz: popula request.user a partir do dono do token', async () => {
    const { ctx, request } = contexto({
      authorization: 'Bearer brb_valido',
      projectId: 'proj-1',
    });
    const g = guard({
      validado: { id: 'pat-1', userId: 'user-1', projectId: 'proj-1' },
    });

    await expect(g.canActivate(ctx)).resolves.toBe(true);
    expect((request.user as User).id).toBe('user-1');
  });

  it('sem header de autorização: 401', async () => {
    const { ctx } = contexto({});
    await expect(guard({}).canActivate(ctx)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('bearer que NÃO começa com brb_: 401 — nunca tenta dual-auth com JWT', async () => {
    const { ctx } = contexto({ authorization: 'Bearer um.jwt.qualquer' });
    const validarEUsar = vi.fn();
    const tokens = { validarEUsar } as unknown as PersonalAccessTokenRepository;
    const g = new PatAuthGuard(tokens, {} as UserRepository);

    await expect(g.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    // Nunca chega a consultar o repositório — recusado só pelo prefixo.
    expect(validarEUsar).not.toHaveBeenCalled();
  });

  it('esquema que não é Bearer: 401', async () => {
    const { ctx } = contexto({ authorization: 'Basic brb_valido' });
    await expect(guard({}).canActivate(ctx)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('token inexistente/revogado/expirado (repositório devolve null): 401', async () => {
    const { ctx } = contexto({ authorization: 'Bearer brb_qualquer' });
    await expect(guard({ validado: null }).canActivate(ctx)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('token válido mas escopado a OUTRO projeto: 403, não 401 — categoria diferente', async () => {
    const { ctx } = contexto({
      authorization: 'Bearer brb_valido',
      projectId: 'proj-alvo',
    });
    const g = guard({
      validado: { id: 'pat-1', userId: 'user-1', projectId: 'proj-diferente' },
    });

    await expect(g.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('dono do token não existe mais: 401', async () => {
    const { ctx } = contexto({ authorization: 'Bearer brb_valido' });
    const g = guard({
      validado: { id: 'pat-1', userId: 'user-sumiu', projectId: 'proj-1' },
      usuario: null,
    });

    await expect(g.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });
});
