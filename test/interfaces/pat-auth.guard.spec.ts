import { describe, it, expect, vi } from 'vitest';
import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { PatAuthGuard } from '../../src/interfaces/http/auth/pat-auth.guard';
import { hashDeToken } from '../../src/infrastructure/security/auth-key-material';
import type { PersonalAccessTokenRepository } from '../../src/application/ports/personal-access-token-repository.port';
import type { RunnerDeviceKeyRepository } from '../../src/application/ports/runner-device-key-repository.port';
import type { UserRepository } from '../../src/application/ports/user-repository.port';
import type { ResolveEffectiveRoleUseCase } from '../../src/application/use-cases/iam/resolve-effective-role.use-case';
import type { Role } from '../../src/domain/iam/role';
import type { User } from '../../src/domain/iam/user.entity';

/**
 * O guard que estabelece `request.user` a partir de uma credencial de
 * dispositivo (ADR 0105/onda da chave de dispositivo) — a peça de segurança
 * central da rota `runner-ticket`. Testado com fakes, não banco real: a
 * validação de verdade do PAT (colapsar inexistente/revogado/expirado) já é
 * coberta em `personal-access-token.repository.spec.ts`; aqui o que importa
 * é o CONTRATO do guard — o que ele aceita, recusa, e em que ordem — pros
 * DOIS caminhos de credencial (PAT e chave de dispositivo).
 *
 * Desde RN-439, este guard também aplica `@RequireRole` — ver o docblock
 * do próprio `PatAuthGuard` pro porquê (`RolesGuard`, guard GLOBAL, roda
 * ANTES do guard LOCAL desta rota e por isso não podia ser quem autoriza).
 */
function contexto(opcoes: {
  authorization?: string;
  projectId?: string;
  papelExigido?: Role;
  /**
   * `true` = rota SEM `:projectId` no caminho — hoje só `GET /runner/projects`
   * (RN-543). Opção própria, e não `projectId: undefined`, para não colidir
   * com o default `'proj-1'` que todo o resto do arquivo usa.
   */
  semProjetoNaRota?: boolean;
}) {
  const request = {
    headers: opcoes.authorization
      ? { authorization: opcoes.authorization }
      : {},
    params: opcoes.semProjetoNaRota
      ? {}
      : { projectId: opcoes.projectId ?? 'proj-1' },
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

function deviceKeysFake(
  opcoes: {
    ativa?: {
      id: string;
      userId: string;
      /** `null` = chave de MÁQUINA (RN-543, ADR 0154). */
      projectId: string | null;
      publicKeyJwk: string;
    } | null;
  } = {},
): RunnerDeviceKeyRepository {
  return {
    buscarChavePublicaAtiva: vi.fn(() =>
      Promise.resolve('ativa' in opcoes ? opcoes.ativa : null),
    ),
    tocarUso: vi.fn(() => Promise.resolve()),
  } as unknown as RunnerDeviceKeyRepository;
}

function guard(opcoes: {
  validado?: { id: string; userId: string; projectId: string } | null;
  usuario?: User | null;
  papelExigido?: Role;
  papelEfetivo?: Role | null;
  deviceKeys?: RunnerDeviceKeyRepository;
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
    guard: new PatAuthGuard(
      tokens,
      users,
      reflector,
      resolveEffectiveRole,
      opcoes.deviceKeys ?? deviceKeysFake(),
    ),
    resolveEffectiveRole,
  };
}

/** Par Ed25519 + JWK pública serializada, no formato salvo em `runner_device_keys`. */
async function parDeChaves() {
  const { publicKey, privateKey } = await generateKeyPair('EdDSA', {
    crv: 'Ed25519',
  });
  const jwk = await exportJWK(publicKey);
  return { privateKey, publicKeyJwk: JSON.stringify(jwk) };
}

async function assinarDeviceKeyJwt(opcoes: {
  privateKey: Parameters<InstanceType<typeof SignJWT>['sign']>[0];
  kid: string;
  /**
   * Omitido = JWT SEM o claim, que é o que a rota sem `:projectId` exige: o
   * claim amarra a assinatura ao projeto PEDIDO, e não há projeto pedido.
   */
  projectId?: string;
  ttlSegundos?: number;
}): Promise<string> {
  const agora = Math.floor(Date.now() / 1000);
  return new SignJWT(
    opcoes.projectId === undefined ? {} : { projectId: opcoes.projectId },
  )
    .setProtectedHeader({ alg: 'EdDSA', kid: opcoes.kid })
    .setIssuedAt(agora)
    .setExpirationTime(agora + (opcoes.ttlSegundos ?? 30))
    .sign(opcoes.privateKey);
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
      deviceKeysFake(),
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

  it('bearer que NÃO começa com brb_ e não tem forma de JWT: 401 — nunca tenta dual-auth com JWT de sessão', async () => {
    const { ctx } = contexto({ authorization: 'Bearer naoebrbnemjwt' });
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
      deviceKeysFake(),
    );

    await expect(g.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    // Nunca chega a consultar o repositório — recusado só pelo prefixo/forma.
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

  describe('chave de dispositivo (JWT EdDSA autoassinado, ao lado do PAT)', () => {
    it('caminho feliz: assinatura válida populate request.user e toca lastUsedAt', async () => {
      const { privateKey, publicKeyJwk } = await parDeChaves();
      const token = await assinarDeviceKeyJwt({
        privateKey,
        kid: 'device-1',
        projectId: 'proj-1',
      });
      const { ctx, request } = contexto({
        authorization: `Bearer ${token}`,
        projectId: 'proj-1',
      });
      const deviceKeys = deviceKeysFake({
        ativa: {
          id: 'device-1',
          userId: 'user-1',
          projectId: 'proj-1',
          publicKeyJwk,
        },
      });
      const { guard: g } = guard({ deviceKeys });

      await expect(g.canActivate(ctx)).resolves.toBe(true);
      expect((request.user as User).id).toBe('user-1');
      expect(deviceKeys.tocarUso).toHaveBeenCalledWith('device-1');
    });

    it('assinatura inválida (JWT assinado com OUTRA chave privada): 401', async () => {
      const { publicKeyJwk } = await parDeChaves();
      const { privateKey: chaveErrada } = await parDeChaves();
      const token = await assinarDeviceKeyJwt({
        privateKey: chaveErrada,
        kid: 'device-1',
        projectId: 'proj-1',
      });
      const { ctx } = contexto({
        authorization: `Bearer ${token}`,
        projectId: 'proj-1',
      });
      const deviceKeys = deviceKeysFake({
        ativa: {
          id: 'device-1',
          userId: 'user-1',
          projectId: 'proj-1',
          publicKeyJwk,
        },
      });
      const { guard: g } = guard({ deviceKeys });

      await expect(g.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
      expect(deviceKeys.tocarUso).not.toHaveBeenCalled();
    });

    it('chave revogada (buscarChavePublicaAtiva devolve null): 401', async () => {
      const { privateKey } = await parDeChaves();
      const token = await assinarDeviceKeyJwt({
        privateKey,
        kid: 'device-revogada',
        projectId: 'proj-1',
      });
      const { ctx } = contexto({
        authorization: `Bearer ${token}`,
        projectId: 'proj-1',
      });
      const { guard: g } = guard({
        deviceKeys: deviceKeysFake({ ativa: null }),
      });

      await expect(g.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    });

    it('projectId do claim NÃO bate com a rota: 403, não 401', async () => {
      const { privateKey, publicKeyJwk } = await parDeChaves();
      const token = await assinarDeviceKeyJwt({
        privateKey,
        kid: 'device-1',
        projectId: 'proj-1',
      });
      const { ctx } = contexto({
        authorization: `Bearer ${token}`,
        projectId: 'proj-OUTRO',
      });
      const deviceKeys = deviceKeysFake({
        ativa: {
          id: 'device-1',
          userId: 'user-1',
          projectId: 'proj-1',
          publicKeyJwk,
        },
      });
      const { guard: g } = guard({ deviceKeys });

      await expect(g.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    });

    it('device key registrada em OUTRO projeto que o claim do JWT (forjado): 403', async () => {
      // O claim `projectId` do JWT bate com a rota, mas a chave em si está
      // registrada para outro projeto — o registro no banco é a fonte de
      // verdade, não o que o token afirma sobre si mesmo.
      const { privateKey, publicKeyJwk } = await parDeChaves();
      const token = await assinarDeviceKeyJwt({
        privateKey,
        kid: 'device-1',
        projectId: 'proj-1',
      });
      const { ctx } = contexto({
        authorization: `Bearer ${token}`,
        projectId: 'proj-1',
      });
      const deviceKeys = deviceKeysFake({
        ativa: {
          id: 'device-1',
          userId: 'user-1',
          projectId: 'proj-DIFERENTE-DO-CLAIM',
          publicKeyJwk,
        },
      });
      const { guard: g } = guard({ deviceKeys });

      await expect(g.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    });

    it('TTL longo demais (exp - iat > 60s): 401, mesmo com assinatura válida', async () => {
      const { privateKey, publicKeyJwk } = await parDeChaves();
      const token = await assinarDeviceKeyJwt({
        privateKey,
        kid: 'device-1',
        projectId: 'proj-1',
        ttlSegundos: 3600,
      });
      const { ctx } = contexto({
        authorization: `Bearer ${token}`,
        projectId: 'proj-1',
      });
      const deviceKeys = deviceKeysFake({
        ativa: {
          id: 'device-1',
          userId: 'user-1',
          projectId: 'proj-1',
          publicKeyJwk,
        },
      });
      const { guard: g } = guard({ deviceKeys });

      await expect(g.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    });

    it('kid sem chave correspondente: 401', async () => {
      const { privateKey } = await parDeChaves();
      const token = await assinarDeviceKeyJwt({
        privateKey,
        kid: 'device-inexistente',
        projectId: 'proj-1',
      });
      const { ctx } = contexto({
        authorization: `Bearer ${token}`,
        projectId: 'proj-1',
      });
      const { guard: g } = guard({
        deviceKeys: deviceKeysFake({ ativa: null }),
      });

      await expect(g.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('chave de MÁQUINA: `project_id` NULL (RN-543, ADR 0154)', () => {
    /** Uma chave de máquina do `user-1`, com o par recém-gerado. */
    async function chaveDeMaquina() {
      const { privateKey, publicKeyJwk } = await parDeChaves();
      return {
        privateKey,
        deviceKeys: deviceKeysFake({
          ativa: {
            id: 'device-maquina',
            userId: 'user-1',
            projectId: null,
            publicKeyJwk,
          },
        }),
      };
    }

    it('caminho feliz: vale para QUALQUER projeto, e o papel se resolve contra o projeto PEDIDO', async () => {
      const { privateKey, deviceKeys } = await chaveDeMaquina();
      const token = await assinarDeviceKeyJwt({
        privateKey,
        kid: 'device-maquina',
        projectId: 'proj-qualquer',
      });
      const { ctx, request } = contexto({
        authorization: `Bearer ${token}`,
        projectId: 'proj-qualquer',
      });
      const { guard: g, resolveEffectiveRole } = guard({
        deviceKeys,
        papelExigido: 'developer',
        papelEfetivo: 'developer',
      });

      await expect(g.canActivate(ctx)).resolves.toBe(true);
      expect((request.user as User).id).toBe('user-1');
      // O ADR 0154 ponto 2 ao pé da letra: "resolvida contra o projeto
      // pedido". Nada de teto novo — é o papel efetivo do DONO que decide.
      expect(resolveEffectiveRole.forProject).toHaveBeenCalledWith(
        'user-1',
        'proj-qualquer',
      );
    });

    it('CASO DE FALHA: papel insuficiente NO PROJETO PEDIDO continua 403 — nenhum teto afrouxado', async () => {
      const { privateKey, deviceKeys } = await chaveDeMaquina();
      const token = await assinarDeviceKeyJwt({
        privateKey,
        kid: 'device-maquina',
        projectId: 'proj-alheio',
      });
      const { ctx } = contexto({
        authorization: `Bearer ${token}`,
        projectId: 'proj-alheio',
      });
      const { guard: g } = guard({
        deviceKeys,
        papelExigido: 'developer',
        papelEfetivo: 'viewer',
      });

      await expect(g.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    });

    it('CASO DE FALHA: sem papel nenhum no projeto pedido, 403 — a chave não amplia alcance', async () => {
      const { privateKey, deviceKeys } = await chaveDeMaquina();
      const token = await assinarDeviceKeyJwt({
        privateKey,
        kid: 'device-maquina',
        projectId: 'proj-de-outra-pessoa',
      });
      const { ctx } = contexto({
        authorization: `Bearer ${token}`,
        projectId: 'proj-de-outra-pessoa',
      });
      const { guard: g } = guard({
        deviceKeys,
        papelExigido: 'developer',
        papelEfetivo: null,
      });

      await expect(g.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    });

    it('o claim continua tendo de nomear o projeto da rota — assinatura de um projeto não vale noutro', async () => {
      const { privateKey, deviceKeys } = await chaveDeMaquina();
      const token = await assinarDeviceKeyJwt({
        privateKey,
        kid: 'device-maquina',
        projectId: 'proj-1',
      });
      const { ctx } = contexto({
        authorization: `Bearer ${token}`,
        projectId: 'proj-OUTRO',
      });
      const { guard: g } = guard({ deviceKeys });

      await expect(g.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    });

    it('A COMPARAÇÃO NÃO SUMIU: chave de PROJETO continua recusada em projeto diferente', async () => {
      // O outro sentido do mesmo invariante — a comparação some SÓ para
      // `null`. Já existe o caso do claim forjado acima; este fixa que a
      // RN-543 não o afrouxou.
      const { privateKey, publicKeyJwk } = await parDeChaves();
      const token = await assinarDeviceKeyJwt({
        privateKey,
        kid: 'device-de-projeto',
        projectId: 'proj-1',
      });
      const { ctx } = contexto({
        authorization: `Bearer ${token}`,
        projectId: 'proj-1',
      });
      const deviceKeys = deviceKeysFake({
        ativa: {
          id: 'device-de-projeto',
          userId: 'user-1',
          projectId: 'proj-2',
          publicKeyJwk,
        },
      });
      const { guard: g } = guard({ deviceKeys, papelEfetivo: 'owner' });

      await expect(g.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    });

    describe('rota SEM `:projectId` no caminho (`GET /runner/projects`)', () => {
      it('caminho feliz: a chave de máquina entra, e nenhum papel é resolvido (o mínimo é por LINHA)', async () => {
        const { privateKey, deviceKeys } = await chaveDeMaquina();
        const token = await assinarDeviceKeyJwt({
          privateKey,
          kid: 'device-maquina',
        });
        const { ctx, request } = contexto({
          authorization: `Bearer ${token}`,
          semProjetoNaRota: true,
        });
        const { guard: g, resolveEffectiveRole } = guard({ deviceKeys });

        await expect(g.canActivate(ctx)).resolves.toBe(true);
        expect((request.user as User).id).toBe('user-1');
        expect(resolveEffectiveRole.forProject).not.toHaveBeenCalled();
      });

      it('CASO DE FALHA: chave de PROJETO é recusada, com mensagem própria — nunca a de "projeto errado"', async () => {
        const { privateKey, publicKeyJwk } = await parDeChaves();
        const token = await assinarDeviceKeyJwt({
          privateKey,
          kid: 'device-de-projeto',
        });
        const { ctx } = contexto({
          authorization: `Bearer ${token}`,
          semProjetoNaRota: true,
        });
        const deviceKeys = deviceKeysFake({
          ativa: {
            id: 'device-de-projeto',
            userId: 'user-1',
            projectId: 'proj-1',
            publicKeyJwk,
          },
        });
        const { guard: g } = guard({ deviceKeys });

        await expect(g.canActivate(ctx)).rejects.toThrow(
          /chave de dispositivo de m.quina/i,
        );
      });

      it('CASO DE FALHA: PAT (sempre preso a um projeto) também é recusado', async () => {
        const { ctx } = contexto({
          authorization: 'Bearer brb_valido',
          semProjetoNaRota: true,
        });
        const { guard: g } = guard({
          validado: { id: 'pat-1', userId: 'user-1', projectId: 'proj-1' },
        });

        await expect(g.canActivate(ctx)).rejects.toThrow(ForbiddenException);
      });

      it('CASO DE FALHA: `@RequireRole` numa rota sem projeto recusa — papel não verificado nunca vale como verificado', async () => {
        const { privateKey, deviceKeys } = await chaveDeMaquina();
        const token = await assinarDeviceKeyJwt({
          privateKey,
          kid: 'device-maquina',
        });
        const { ctx } = contexto({
          authorization: `Bearer ${token}`,
          semProjetoNaRota: true,
        });
        const { guard: g, resolveEffectiveRole } = guard({
          deviceKeys,
          papelExigido: 'developer',
          papelEfetivo: 'owner',
        });

        await expect(g.canActivate(ctx)).rejects.toThrow(ForbiddenException);
        expect(resolveEffectiveRole.forProject).not.toHaveBeenCalled();
      });

      it('JWT que NOMEIA um projeto não passa a valer numa rota que não pede projeto', async () => {
        const { privateKey, deviceKeys } = await chaveDeMaquina();
        const token = await assinarDeviceKeyJwt({
          privateKey,
          kid: 'device-maquina',
          projectId: 'proj-1',
        });
        const { ctx } = contexto({
          authorization: `Bearer ${token}`,
          semProjetoNaRota: true,
        });
        const { guard: g } = guard({ deviceKeys });

        await expect(g.canActivate(ctx)).rejects.toThrow(ForbiddenException);
      });
    });
  });
});
