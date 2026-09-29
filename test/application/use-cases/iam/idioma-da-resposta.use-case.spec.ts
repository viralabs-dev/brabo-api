import { describe, expect, it } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { UserRepository } from '../../../../src/application/ports/user-repository.port';
import type { SessionRepository } from '../../../../src/application/ports/session-repository.port';
import type { SessionLanguageOverrideRepository } from '../../../../src/application/ports/session-language-override-repository.port';
import type { User } from '../../../../src/domain/iam/user.entity';
import { ResolverIdiomaDaRespostaUseCase } from '../../../../src/application/use-cases/iam/resolver-idioma-da-resposta.use-case';
import { GetUserPreferencesUseCase } from '../../../../src/application/use-cases/iam/get-user-preferences.use-case';
import { UpdateUserPreferencesUseCase } from '../../../../src/application/use-cases/iam/update-user-preferences.use-case';
import { IdiomaDaRespostaNaSessaoUseCase } from '../../../../src/application/use-cases/iam/idioma-da-resposta-na-sessao.use-case';

/**
 * O idioma das respostas dos agentes, por conta e por sessão (RN-618).
 *
 * Repositórios falsos em memória: a régua e a precedência são do domínio; o
 * que estes casos provam é o que cada rota GRAVA e o que ela NÃO toca.
 */

const USUARIO = 'user-1';
const OUTRO = 'user-2';
const PROJETO = 'proj-1';
const SESSAO = 'sess-1';

function usuario(overrides: Partial<User> = {}): User {
  return {
    id: USUARIO,
    keycloakSub: null,
    email: 'ana@brabo.dev',
    name: 'Ana',
    locale: 'pt-BR',
    responseLanguage: null,
    detectedLanguage: null,
    detectedLanguageConfirmedAt: null,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    updatedAt: new Date('2026-09-01T00:00:00Z'),
    ...overrides,
  };
}

function montar(inicial: Partial<User> = {}) {
  const usuarios = new Map<string, User>([
    [USUARIO, usuario(inicial)],
    [OUTRO, usuario({ id: OUTRO, email: 'bob@brabo.dev' })],
  ]);
  const escritas: string[] = [];
  const userRepo = {
    findById: (id: string) => Promise.resolve(usuarios.get(id) ?? null),
    updateLocale: (id: string, locale: User['locale']) => {
      escritas.push(`locale=${locale}`);
      const u = { ...usuarios.get(id)!, locale };
      usuarios.set(id, u);
      return Promise.resolve(u);
    },
    updateResponseLanguage: (id: string, responseLanguage: string | null) => {
      escritas.push(`responseLanguage=${String(responseLanguage)}`);
      const u = { ...usuarios.get(id)!, responseLanguage };
      usuarios.set(id, u);
      return Promise.resolve(u);
    },
  } as unknown as UserRepository;

  const overrides = new Map<string, string>();
  const chave = (s: string, u: string) => `${s}|${u}`;
  const overrideRepo: SessionLanguageOverrideRepository = {
    find: (s, u) => Promise.resolve(overrides.get(chave(s, u)) ?? null),
    set: (s, u, l) => {
      overrides.set(chave(s, u), l);
      return Promise.resolve();
    },
    clear: (s, u) => {
      overrides.delete(chave(s, u));
      return Promise.resolve();
    },
  };
  const sessionRepo = {
    findInProject: (p: string, s: string) =>
      Promise.resolve(p === PROJETO && s === SESSAO ? { id: s } : null),
  } as unknown as SessionRepository;

  const resolver = new ResolverIdiomaDaRespostaUseCase(userRepo, overrideRepo);
  return {
    usuarios,
    escritas,
    resolver,
    get: new GetUserPreferencesUseCase(resolver),
    update: new UpdateUserPreferencesUseCase(userRepo, resolver),
    sessao: new IdiomaDaRespostaNaSessaoUseCase(
      sessionRepo,
      overrideRepo,
      resolver,
    ),
  };
}

describe('preferências da conta (RN-618)', () => {
  it('conta nova nasce AUTOMÁTICO e resolve pelo idioma da interface', async () => {
    const { get } = montar();

    expect(await get.execute(USUARIO)).toEqual({
      locale: 'pt-BR',
      responseLanguage: 'automatico',
      detectedLanguage: null,
      detectedLanguageConfirmedAt: null,
      effectiveResponseLanguage: { language: 'pt-BR', origin: 'interface' },
    });
  });

  it('o detectado CONFIRMADO vale no automático', async () => {
    const confirmado = new Date('2026-09-20T00:00:00Z');
    const { get } = montar({
      detectedLanguage: 'en',
      detectedLanguageConfirmedAt: confirmado,
    });

    const prefs = await get.execute(USUARIO);

    expect(prefs.effectiveResponseLanguage).toEqual({
      language: 'en',
      origin: 'detectado',
    });
    expect(prefs.detectedLanguageConfirmedAt).toBe(confirmado);
  });

  it('escolher um idioma grava a forma CANÔNICA e NÃO toca o idioma da interface', async () => {
    const { update, escritas } = montar();

    const prefs = await update.execute(USUARIO, { responseLanguage: 'es-mx' });

    expect(escritas).toEqual(['responseLanguage=es-MX']);
    expect(prefs.locale).toBe('pt-BR');
    expect(prefs.responseLanguage).toBe('es-MX');
    expect(prefs.effectiveResponseLanguage).toEqual({
      language: 'es-MX',
      origin: 'conta',
    });
  });

  it('"automatico" volta ao automático gravando NULL', async () => {
    const { update, escritas } = montar({ responseLanguage: 'en' });

    const prefs = await update.execute(USUARIO, {
      responseLanguage: 'automatico',
    });

    expect(escritas).toEqual(['responseLanguage=null']);
    expect(prefs.responseLanguage).toBe('automatico');
  });

  it('trocar só a interface não toca o idioma das respostas (o caminho de sempre continua)', async () => {
    const { update, escritas } = montar({ responseLanguage: 'es' });

    const prefs = await update.execute(USUARIO, { locale: 'en' });

    expect(escritas).toEqual(['locale=en']);
    expect(prefs.responseLanguage).toBe('es');
  });

  it('código que não é idioma é 400 e NADA do corpo é gravado — nem o locale que veio junto', async () => {
    const { update, escritas } = montar();

    await expect(
      update.execute(USUARIO, { locale: 'en', responseLanguage: 'zz' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(escritas).toEqual([]);
  });

  it('corpo sem nenhum dos dois campos é 400', async () => {
    const { update } = montar();

    await expect(update.execute(USUARIO, {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('override por sessão (RN-618) — só de quem fixou, só naquela sessão', () => {
  it('fixar na sessão vence a conta, e a conta continua igual', async () => {
    const { sessao, get } = montar({ responseLanguage: 'es' });

    const r = await sessao.definir(PROJETO, SESSAO, USUARIO, 'fr');

    expect(r.idioma).toBe('fr');
    expect(r.origem).toBe('sessao');
    expect(r.fontes.conta).toBe('es');
    expect((await get.execute(USUARIO)).responseLanguage).toBe('es');
  });

  it('o override de uma pessoa não alcança o outro participante da MESMA sessão', async () => {
    const { sessao } = montar();

    await sessao.definir(PROJETO, SESSAO, USUARIO, 'fr');
    const doOutro = await sessao.ler(PROJETO, SESSAO, OUTRO);

    expect(doOutro.idioma).toBe('pt-BR');
    expect(doOutro.origem).toBe('interface');
    expect(doOutro.fontes.sessao).toBeNull();
  });

  it('null solta o override e a pessoa volta a herdar da conta', async () => {
    const { sessao } = montar({ responseLanguage: 'es' });
    await sessao.definir(PROJETO, SESSAO, USUARIO, 'fr');

    const r = await sessao.definir(PROJETO, SESSAO, USUARIO, null);

    expect(r).toMatchObject({ idioma: 'es', origem: 'conta' });
    expect(r.fontes.sessao).toBeNull();
  });

  it('sessão de outro projeto (ou inexistente) é 404', async () => {
    const { sessao } = montar();

    await expect(
      sessao.ler('outro-projeto', SESSAO, USUARIO),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      sessao.definir(PROJETO, 'outra-sessao', USUARIO, 'en'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('código inválido é 400, pela mesma régua da conta', async () => {
    const { sessao } = montar();

    await expect(
      sessao.definir(PROJETO, SESSAO, USUARIO, 'klingon-mesmo'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
