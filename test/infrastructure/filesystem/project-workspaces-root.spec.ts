import { describe, it, expect, afterEach } from 'vitest';
import {
  CaminhoForaDoEscopoError,
  caminhoDeRepositorioContido,
  garantirQueryEscalar,
  projectScopeRoot,
  projectWorkspacesRoot,
  workspaceDirNameFor,
} from '../../../src/infrastructure/filesystem/project-workspaces-root';

/**
 * `workspaceDirNameFor` (RN-109): nome de pasta legível pra projeto NOVO.
 */
describe('workspaceDirNameFor', () => {
  it('compõe slug + 8 primeiros chars do id', () => {
    expect(
      workspaceDirNameFor('3f2b1c8e-0a5d-4f6b-9c1e-2d7a8b3c4d5e', 'checkout'),
    ).toBe('checkout-3f2b1c8e');
  });

  it('o resultado passa na validação de projectScopeRoot', () => {
    const nome = workspaceDirNameFor(
      '3f2b1c8e-0a5d-4f6b-9c1e-2d7a8b3c4d5e',
      'meu-projeto',
    );
    expect(() => projectScopeRoot(nome)).not.toThrow();
  });
});

/**
 * Contenção do escopo de projeto (CodeQL `js/path-injection`).
 *
 * `projectScopeRoot` recebe `workspace_dir_name` (RN-109) — para projeto de
 * antes dessa coluna existir ele É o UUID puro, então os casos abaixo
 * continuam valendo tal como estão. Sem a checagem, o `join` resolvia para
 * fora da raiz em silêncio, e isso atingia tanto o `permissions.json` quanto
 * o escopo que AUTORIZA comando de terminal (ADR 0055).
 */

// Montado por código, e não escrito literalmente, porque um NUL cru no fonte
// faz o git tratar o arquivo como binário — o diff some da revisão.
const NUL = String.fromCharCode(0);

describe('projectScopeRoot', () => {
  afterEach(() => {
    delete process.env.PROJECT_WORKSPACES_ROOT;
  });

  it('caminho feliz: um UUID vira pasta sob a raiz', () => {
    process.env.PROJECT_WORKSPACES_ROOT = '/var/brabo';
    expect(projectScopeRoot('3f2b1c8e-0a5d-4f6b-9c1e-2d7a8b3c4d5e')).toBe(
      '/var/brabo/3f2b1c8e-0a5d-4f6b-9c1e-2d7a8b3c4d5e',
    );
  });

  it.each([
    ['..', 'o pai direto'],
    ['../../etc', 'travessia relativa — o que `..%2F..%2Fetc` vira'],
    ['a/b', 'separador no meio'],
    ['/etc/passwd', 'caminho absoluto'],
    ['.', 'a própria raiz'],
    ['', 'vazio, que faria o escopo ser a raiz inteira'],
    [`proj${NUL}eto`, 'byte NUL, que trunca o caminho no syscall'],
  ])('RECUSA %j — %s', (workspaceDirName) => {
    expect(() => projectScopeRoot(workspaceDirName)).toThrow(
      /workspaceDirName inválido/,
    );
  });

  it('nenhum id aceito escapa da raiz', () => {
    process.env.PROJECT_WORKSPACES_ROOT = '/var/brabo';
    for (const id of ['abc', 'A-1_b', '0'.repeat(64)]) {
      expect(projectScopeRoot(id).startsWith('/var/brabo/')).toBe(true);
    }
  });

  it('a raiz tem default de desenvolvimento e é lida do ambiente', () => {
    expect(projectWorkspacesRoot()).toBe('/tmp/brabo-project-workspaces');
    process.env.PROJECT_WORKSPACES_ROOT = '/var/brabo';
    expect(projectWorkspacesRoot()).toBe('/var/brabo');
  });
});

/**
 * A mesma contenção, agora para o caminho de ARQUIVO que o cliente pede na aba
 * Code (RN-095, FASE 26b).
 *
 * A rota é de leitura, o que faz o vetor parecer inofensivo — e não é. Nos
 * providers remotos o caminho vira segmento de URL da API do provider, então um
 * `../../` troca de ENDPOINT com a credencial do OWNER do workspace na mão
 * (RN-058/RN-082). No local ele vira o lado direito de `git show <ref>:<path>`.
 *
 * Está no MESMO arquivo do `projectScopeRoot` de propósito: são a mesma
 * decisão, e separá-las convidaria a próxima pessoa a escrever uma terceira.
 */
describe('caminhoDeRepositorioContido', () => {
  const PROJETO = '3f2b1c8e-0a5d-4f6b-9c1e-2d7a8b3c4d5e';

  it.each([
    ['apps/api/src/main.ts', 'apps/api/src/main.ts'],
    ['', ''],
    [undefined, ''],
    ['./apps/api', 'apps/api'],
    ['apps/web/../api/src', 'apps/api/src'],
    ['apps//api', 'apps/api'],
  ])('caminho feliz: %j vira %j', (entrada, esperado) => {
    expect(caminhoDeRepositorioContido(PROJETO, entrada)).toBe(esperado);
  });

  it.each([
    [
      '../outro-projeto/permissions.json',
      'sobe um nível e cai em outro projeto',
    ],
    ['../../etc/passwd', 'o que `..%2F..%2Fetc%2Fpasswd` vira no Express'],
    ['/etc/passwd', 'absoluto fora da raiz'],
    [
      '/apps/api',
      'absoluto que POR ACASO existiria no repo — reinterpretar a barra ' +
        'inicial como "relativo à raiz" seria conferir uma string e usar outra',
    ],
    [
      'apps/../../../root/.ssh/id_rsa',
      'sobe DEPOIS de descer — o caso que uma checagem de prefixo ingênua deixa passar',
    ],
    [`app${NUL}s`, 'byte NUL, que trunca o caminho no syscall'],
  ])('RECUSA %j — %s', (caminho) => {
    expect(() => caminhoDeRepositorioContido(PROJETO, caminho)).toThrow(
      CaminhoForaDoEscopoError,
    );
  });

  it('recusa workspaceDirName que não é segmento de caminho — a MESMA checagem', () => {
    // Não é duplicata do teste de cima: aqui o ponto é que a função nova não
    // reimplementou a validação de `workspaceDirName`, e sim passou por ela.
    expect(() => caminhoDeRepositorioContido('../../etc', 'README.md')).toThrow(
      /workspaceDirName inválido/,
    );
  });

  it('o normalizado é o que volta — validar uma string e usar outra é o bug', () => {
    // Se o chamador recebesse o caminho ORIGINAL, ele mandaria `a/../b` ao
    // provider tendo validado `b`. A contenção só vale se ela devolve o que
    // conferiu.
    expect(caminhoDeRepositorioContido(PROJETO, 'a/./b/../c')).toBe('a/c');
  });

  it('RECUSA `path` como array — a confusão de tipo do CodeQL (RN-127)', () => {
    // `?path=a&path=b` chega como array no Express; sem esta checagem,
    // `.includes('\0')` teria semântica de elemento exato (não substring) e
    // um valor como `['x/../y']` escaparia da recusa de `..`.
    expect(() =>
      caminhoDeRepositorioContido(
        PROJETO,
        // @ts-expect-error — runtime pode entregar array mesmo o tipo dizendo string
        ['a', 'b'],
      ),
    ).toThrow(CaminhoForaDoEscopoError);
  });
});

/**
 * `garantirQueryEscalar` isolada (RN-127) — o guarda que
 * `caminhoDeRepositorioContido` e `ReadProjectCodeUseCase.alvo` reusam.
 */
describe('garantirQueryEscalar', () => {
  it('devolve o valor escalar sem tocar nele', () => {
    expect(garantirQueryEscalar('a/b', () => new Error('não deveria'))).toBe(
      'a/b',
    );
    expect(
      garantirQueryEscalar(undefined, () => new Error('não deveria')),
    ).toBeUndefined();
  });

  it('lança o erro do chamador quando o valor é array', () => {
    const erro = new Error('parâmetro repetido');
    expect(() => garantirQueryEscalar(['a', 'b'], () => erro)).toThrow(erro);
  });
});
