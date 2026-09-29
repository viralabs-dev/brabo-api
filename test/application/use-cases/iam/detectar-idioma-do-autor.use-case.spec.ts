import { describe, expect, it } from 'vitest';
import { BadRequestException, ConflictException } from '@nestjs/common';
import type { UserRepository } from '../../../../src/application/ports/user-repository.port';
import type { SessionLanguageOverrideRepository } from '../../../../src/application/ports/session-language-override-repository.port';
import type {
  DeteccaoDeIdiomaRepository,
  EventoDeEvidencia,
} from '../../../../src/application/ports/deteccao-de-idioma-repository.port';
import type { User } from '../../../../src/domain/iam/user.entity';
import { ResolverIdiomaDaRespostaUseCase } from '../../../../src/application/use-cases/iam/resolver-idioma-da-resposta.use-case';
import { DetectarIdiomaDoAutorUseCase } from '../../../../src/application/use-cases/iam/detectar-idioma-do-autor.use-case';

/**
 * A detecção do idioma do autor e a pergunta de confirmação (AT-163, RN-624).
 *
 * Repositórios em memória: o que se prova aqui é quando há pergunta, o que
 * cada resposta GRAVA, e que a falha da detecção nunca vira erro. Os textos
 * são sintéticos.
 */

const USUARIO = 'user-1';
const ES = [
  '¿Puedes revisar por qué falla la prueba? Gracias, pero ahora no entiendo muy bien cómo funciona la configuración del proyecto.',
  'Hola, también quiero saber cómo cambiar la versión. Entonces, ¿qué hago ahora? Muchas gracias por la explicación, es muy útil.',
];

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

function montar(
  opcoes: {
    mensagens?: string[];
    inicial?: Partial<User>;
    falhaNaLeitura?: boolean;
  } = {},
) {
  let atual = usuario(opcoes.inicial);
  let mensagens = opcoes.mensagens ?? [];
  const recusas = new Set<string>();
  const escritas: string[] = [];

  const userRepo = {
    findById: () => Promise.resolve(atual),
  } as unknown as UserRepository;
  const overrideRepo = {
    find: () => Promise.resolve(null),
  } as unknown as SessionLanguageOverrideRepository;

  const repo: DeteccaoDeIdiomaRepository = {
    ultimasEvidencias: (_u, limite) => {
      if (opcoes.falhaNaLeitura) {
        return Promise.reject(new Error('conexão recusada'));
      }
      const eventos: EventoDeEvidencia[] = mensagens.map((text) => ({
        sessionId: 's1',
        tipo: 'chat.message',
        payload: { text },
      }));
      return Promise.resolve(eventos.slice(-limite));
    },
    recusados: () => Promise.resolve([...recusas]),
    recusar: (_u, idioma) => {
      escritas.push(`recusar=${idioma}`);
      recusas.add(idioma);
      return Promise.resolve();
    },
    confirmar: (_u, idioma, em) => {
      escritas.push(`confirmar=${idioma}`);
      recusas.delete(idioma);
      atual = {
        ...atual,
        detectedLanguage: idioma,
        detectedLanguageConfirmedAt: em,
      };
      return Promise.resolve();
    },
  };

  const resolver = new ResolverIdiomaDaRespostaUseCase(userRepo, overrideRepo);
  const deteccao = new DetectarIdiomaDoAutorUseCase(repo, resolver);
  const efetivo = async () => {
    const r = await resolver.execute(USUARIO);
    return { idioma: r.idioma, origem: r.origem };
  };
  return {
    deteccao,
    efetivo,
    escritas,
    trocarMensagens: (m: string[]) => {
      mensagens = m;
    },
  };
}

describe('a pergunta da detecção (RN-624)', () => {
  it('quem escreve em espanhol com a interface em pt-BR é PERGUNTADO — e nada é gravado por isso', async () => {
    const { deteccao, efetivo, escritas } = montar({ mensagens: ES });

    expect(await deteccao.pergunta(USUARIO, await efetivo())).toBe('es');
    expect(escritas).toEqual([]);
  });

  it('confirmar grava o detectado CONFIRMADO, que passa a ser o efetivo, e a pergunta some', async () => {
    const { deteccao, efetivo, escritas } = montar({ mensagens: ES });

    const prefs = await deteccao.responder(USUARIO, 'es', 'confirm');

    expect(escritas).toEqual(['confirmar=es']);
    expect(prefs.detectedLanguage).toBe('es');
    expect(prefs.detectedLanguageConfirmedAt).toBeInstanceOf(Date);
    expect(prefs.effectiveResponseLanguage).toEqual({
      language: 'es',
      origin: 'detectado',
    });
    expect(await deteccao.pergunta(USUARIO, await efetivo())).toBeNull();
  });

  it('recusar grava a recusa e o MESMO idioma não é perguntado de novo', async () => {
    const { deteccao, efetivo, escritas } = montar({ mensagens: ES });

    const prefs = await deteccao.responder(USUARIO, 'es', 'decline');

    expect(escritas).toEqual(['recusar=es']);
    expect(prefs.detectedLanguage).toBeNull();
    expect(prefs.effectiveResponseLanguage.language).toBe('pt-BR');
    expect(await deteccao.pergunta(USUARIO, await efetivo())).toBeNull();
  });

  it('heurística indeterminada ("ok", mensagens curtas) não pergunta', async () => {
    const { deteccao, efetivo } = montar({ mensagens: ['ok', 'sim', 'valeu'] });

    expect(await deteccao.pergunta(USUARIO, await efetivo())).toBeNull();
  });

  it('escolha explícita na Conta: não pergunta, e nem lê o event log', async () => {
    const { deteccao, efetivo } = montar({
      mensagens: ES,
      inicial: { responseLanguage: 'pt-BR' },
      falhaNaLeitura: true,
    });

    expect(await efetivo()).toEqual({ idioma: 'pt-BR', origem: 'conta' });
    expect(await deteccao.pergunta(USUARIO, await efetivo())).toBeNull();
  });

  it('erro na detecção vira "sem pergunta", nunca uma exceção', async () => {
    const { deteccao, efetivo } = montar({ falhaNaLeitura: true });

    await expect(
      deteccao.pergunta(USUARIO, await efetivo()),
    ).resolves.toBeNull();
  });
});

describe('a resposta à pergunta (RN-624)', () => {
  it('confirmar um idioma que as mensagens NÃO apontam mais é 409 e não grava nada', async () => {
    const { deteccao, escritas, trocarMensagens } = montar({ mensagens: ES });
    trocarMensagens(['ok']);

    const erro = await deteccao
      .responder(USUARIO, 'es', 'confirm')
      .catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(ConflictException);
    expect((erro as ConflictException).getResponse()).toMatchObject({
      code: 'deteccao_mudou',
    });
    expect(escritas).toEqual([]);
  });

  it('código que não é idioma é 400', async () => {
    const { deteccao, escritas } = montar({ mensagens: ES });

    await expect(
      deteccao.responder(USUARIO, 'zz', 'decline'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(escritas).toEqual([]);
  });
});
