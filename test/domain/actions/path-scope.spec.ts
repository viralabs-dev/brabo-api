import { describe, it, expect } from 'vitest';
import { parseCommand } from '../../../src/domain/actions/command-matcher';
import {
  comandoNoEscopo,
  dentroDoEscopo,
  normalizarCaminho,
  tokensDeCaminho,
} from '../../../src/domain/actions/path-scope';

const RAIZ = '/data/project-workspaces/proj-1';

describe('normalizarCaminho', () => {
  it('resolve `..` sem tocar o disco', () => {
    expect(normalizarCaminho('/a/b/../c')).toBe('/a/c');
    expect(normalizarCaminho('/a/b/../..')).toBe('/');
  });

  it('ancora caminho relativo na base', () => {
    expect(normalizarCaminho('docs/x.md', '/a/b')).toBe('/a/b/docs/x.md');
  });
});

describe('dentroDoEscopo', () => {
  it('a própria raiz conta como dentro', () => {
    expect(dentroDoEscopo(RAIZ, RAIZ)).toBe(true);
  });

  it('subpasta está dentro', () => {
    expect(dentroDoEscopo(`${RAIZ}/.worktrees/dev-api`, RAIZ)).toBe(true);
  });

  it('irmão com o mesmo PREFIXO de nome está FORA', () => {
    // Sem a barra final na comparação, `/…/proj-1` casaria `/…/proj-10`, que é
    // outro projeto. É o erro clássico de comparar caminho por prefixo de
    // string, e o que separa este escopo do paliativo que ele substitui.
    expect(dentroDoEscopo('/data/project-workspaces/proj-10', RAIZ)).toBe(false);
  });

  it('`..` NÃO escapa', () => {
    // A fraqueza exata do paliativo aplicado em produção: ele comparava
    // prefixo de string, então `<raiz>/../..` começava com a raiz e saía dela.
    expect(dentroDoEscopo(`${RAIZ}/../outro`, RAIZ)).toBe(false);
    expect(dentroDoEscopo(`${RAIZ}/../..`, RAIZ)).toBe(false);
  });

  it('caminho de fora está fora', () => {
    expect(dentroDoEscopo('/workspace/apps/engine', RAIZ)).toBe(false);
  });
});

describe('tokensDeCaminho', () => {
  it('pega absoluto e `..`, ignora o que não é caminho', () => {
    const segmentos = parseCommand('find . -maxdepth 4 -name *.ex /etc/passwd');
    expect(tokensDeCaminho(segmentos)).toEqual(['/etc/passwd']);
  });

  it('não confunde flag nem número com caminho', () => {
    const segmentos = parseCommand('head -50 arquivo.txt');
    expect(tokensDeCaminho(segmentos)).toEqual([]);
  });
});

describe('comandoNoEscopo', () => {
  const noEscopo = (cmd: string, cwd?: string) =>
    comandoNoEscopo(parseCommand(cmd), cwd, RAIZ);

  it('comando relativo com cwd dentro do escopo passa', () => {
    expect(noEscopo('cat README.md', `${RAIZ}/.worktrees/dev-api`)).toBe(true);
  });

  it('cwd fora do escopo reprova, mesmo com comando inofensivo', () => {
    expect(noEscopo('ls', '/workspace/apps/engine')).toBe(false);
  });

  it('sem cwd usa a raiz do projeto, que está no escopo por construção', () => {
    expect(noEscopo('ls -la')).toBe(true);
  });

  it('caminho absoluto de fora reprova o comando inteiro', () => {
    // O achado U: `cat` está em allow, e sem escopo isto era auto-aprovado.
    expect(
      noEscopo(
        'cat /workspace/apps/engine/lib/engine/actions/git_executor.ex',
        `${RAIZ}/.worktrees/dev-api`,
      ),
    ).toBe(false);
  });

  it('UM caminho de fora contamina o comando composto todo', () => {
    expect(
      noEscopo(`cd ${RAIZ} && cat /etc/passwd`, `${RAIZ}/.worktrees/dev-api`),
    ).toBe(false);
  });

  it('`..` que sai do escopo reprova mesmo com cwd dentro', () => {
    expect(noEscopo('cat ../../../etc/passwd', `${RAIZ}/.worktrees/dev-api`)).toBe(
      false,
    );
  });

  it('`..` que continua dentro do escopo passa', () => {
    expect(noEscopo('cat ../dev-web/README.md', `${RAIZ}/.worktrees/dev-api`)).toBe(
      true,
    );
  });

  it('outro projeto está fora, mesmo sendo do mesmo usuário', () => {
    expect(
      noEscopo(
        'cd /data/project-workspaces/proj-2/.worktrees/dev-api',
        `${RAIZ}/.worktrees/dev-api`,
      ),
    ).toBe(false);
  });
});
