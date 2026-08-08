import { describe, it, expect, afterEach } from 'vitest';
import {
  CaminhoForaDoEscopoError,
  caminhoDeRepositorioContido,
  projectScopeRoot,
  projectWorkspacesRoot,
} from '../../../src/infrastructure/filesystem/project-workspaces-root';

/**
 * Contenção do escopo de projeto (CodeQL `js/path-injection`).
 *
 * O `projectId` chega de um parâmetro de rota sem pipe de validação e o Express
 * já decodificou o percent-encoding — `..%2F..%2Fetc` chega como `../../etc`.
 * Sem a checagem, o `join` resolvia para fora da raiz em silêncio, e isso
 * atingia tanto o `permissions.json` quanto o escopo que AUTORIZA comando de
 * terminal (ADR 0055).
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
  ])('RECUSA %j — %s', (projectId) => {
    expect(() => projectScopeRoot(projectId)).toThrow(/projectId inválido/);
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
    ['../outro-projeto/permissions.json', 'sobe um nível e cai em outro projeto'],
    ['../../etc/passwd', 'o que `..%2F..%2Fetc%2Fpasswd` vira no Express'],
    ['/etc/passwd', 'absoluto fora da raiz'],
    [
      '/apps/api',
      'absoluto que POR ACASO existiria no repo — reinterpretar a barra ' +
        'inicial como "relativo à raiz" seria conferir uma string e usar outra',
    ],
    ['apps/../../../root/.ssh/id_rsa', 'sobe DEPOIS de descer — o caso que uma checagem de prefixo ingênua deixa passar'],
    [`app${NUL}s`, 'byte NUL, que trunca o caminho no syscall'],
  ])('RECUSA %j — %s', (caminho) => {
    expect(() => caminhoDeRepositorioContido(PROJETO, caminho)).toThrow(
      CaminhoForaDoEscopoError,
    );
  });

  it('recusa projectId que não é segmento de caminho — a MESMA checagem', () => {
    // Não é duplicata do teste de cima: aqui o ponto é que a função nova não
    // reimplementou a validação de `projectId`, e sim passou por ela.
    expect(() => caminhoDeRepositorioContido('../../etc', 'README.md')).toThrow(
      /projectId inválido/,
    );
  });

  it('o normalizado é o que volta — validar uma string e usar outra é o bug', () => {
    // Se o chamador recebesse o caminho ORIGINAL, ele mandaria `a/../b` ao
    // provider tendo validado `b`. A contenção só vale se ela devolve o que
    // conferiu.
    expect(caminhoDeRepositorioContido(PROJETO, 'a/./b/../c')).toBe('a/c');
  });
});
