import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCommand } from '../../../src/domain/actions/command-matcher';
import {
  comandoNoEscopo,
  comandoNoEscopoDoContainer,
  cwdNoContainer,
  PONTO_DE_MONTAGEM_DO_CONTAINER,
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
    expect(dentroDoEscopo('/data/project-workspaces/proj-10', RAIZ)).toBe(
      false,
    );
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
    expect(
      noEscopo('cat ../../../etc/passwd', `${RAIZ}/.worktrees/dev-api`),
    ).toBe(false);
  });

  it('`..` que continua dentro do escopo passa', () => {
    expect(
      noEscopo('cat ../dev-web/README.md', `${RAIZ}/.worktrees/dev-api`),
    ).toBe(true);
  });

  it('outro projeto está fora, mesmo sendo do mesmo usuário', () => {
    expect(
      noEscopo(
        'cd /data/project-workspaces/proj-2/.worktrees/dev-api',
        `${RAIZ}/.worktrees/dev-api`,
      ),
    ).toBe(false);
  });
  // --- achado AC da FASE 13b -------------------------------------------
  describe('redirecionamento (achado AC)', () => {
    it('2>/dev/null não é caminho de usuário — o comando continua no escopo', () => {
      // O caso real: o agente de QA rodou
      // `ls -la && … cat package.json 2>/dev/null`. Todos os verbos estavam
      // liberados, e mesmo assim virava require_approval.
      const segs = parseCommand('cat package.json 2>/dev/null');

      expect(tokensDeCaminho(segs)).toEqual([]);
      expect(comandoNoEscopo(segs, RAIZ, RAIZ)).toBe(true);
    });

    it('os fluxos padrão também são neutros', () => {
      const segs = parseCommand('echo oi > /dev/stdout 2> /dev/stderr');
      expect(tokensDeCaminho(segs)).toEqual([]);
      expect(comandoNoEscopo(segs, RAIZ, RAIZ)).toBe(true);
    });

    // O que NÃO pode afrouxar: o alvo do redirecionamento continua sendo
    // avaliado como caminho. Se isto quebrar, a correção do AC virou buraco.
    it('redirecionar para FORA do projeto continua fora do escopo', () => {
      const segs = parseCommand('echo x > /etc/passwd');

      expect(tokensDeCaminho(segs)).toContain('/etc/passwd');
      expect(comandoNoEscopo(segs, RAIZ, RAIZ)).toBe(false);
    });

    it('`/dev` NÃO é liberado inteiro — só os neutros', () => {
      // `/dev/sda` é disco; `/dev/mem` é memória física. Liberar `/dev`
      // inteiro trocaria um incômodo por um buraco.
      const segs = parseCommand('cat /dev/sda > dump.bin');

      expect(tokensDeCaminho(segs)).toContain('/dev/sda');
      expect(comandoNoEscopo(segs, RAIZ, RAIZ)).toBe(false);
    });

    it('redirecionar para dentro do projeto continua permitido', () => {
      const segs = parseCommand('npm test > saida.log');
      expect(comandoNoEscopo(segs, RAIZ, RAIZ)).toBe(true);
    });
  });
  // --- ReDoS apontado pelo CodeQL (js/polynomial-redos, HIGH) -----------
  describe('barras finais sem regex', () => {
    it('raiz com barras repetidas ainda casa', () => {
      expect(dentroDoEscopo(`${RAIZ}/src/a.ts`, `${RAIZ}///`)).toBe(true);
      expect(dentroDoEscopo(RAIZ, `${RAIZ}/`)).toBe(true);
    });

    it('a raiz `/` sobrevive — não vira string vazia', () => {
      // Se o corte comesse a última barra, a raiz `/` viraria '' e
      // `startsWith('/')` passaria a valer para QUALQUER caminho.
      expect(dentroDoEscopo('/qualquer/coisa', '/')).toBe(true);
      expect(dentroDoEscopo('/', '/')).toBe(true);
    });

    it('o prefixo continua exigindo a barra — projeto vizinho segue de fora', () => {
      expect(dentroDoEscopo('/data/ws/abcdef/x', '/data/ws/abc')).toBe(false);
    });

    it('entrada patológica termina rápido', () => {
      // O caso que o CodeQL apontou: milhares de barras faziam o motor de
      // regex retroceder em O(n²). Sem regex é varredura linear.
      const barras = '/'.repeat(50_000);
      const inicio = Date.now();

      expect(dentroDoEscopo('/data/ws/x', `${RAIZ}${barras}`)).toBe(false);

      expect(Date.now() - inicio).toBeLessThan(1000);
    });
  });
});

/**
 * A raiz do escopo dentro do container (RN-669, ADR 0189, AT-258).
 */
describe('cwdNoContainer — a mesma tradução que o engine faz', () => {
  it('a raiz do projeto vira /work, e o que está sob ela vira /work/...', () => {
    expect(cwdNoContainer(RAIZ, RAIZ)).toBe('/work');
    expect(cwdNoContainer(`${RAIZ}/`, RAIZ)).toBe('/work');
    expect(cwdNoContainer(`${RAIZ}/.worktrees/dev-api`, RAIZ)).toBe(
      '/work/.worktrees/dev-api',
    );
  });

  it('o que está FORA da raiz segue como veio — nunca é fabricado um /work', () => {
    expect(cwdNoContainer('/data/project-workspaces/proj-10', RAIZ)).toBe(
      '/data/project-workspaces/proj-10',
    );
    expect(cwdNoContainer(`${RAIZ}/../proj-2`, RAIZ)).toBe(
      '/data/project-workspaces/proj-2',
    );
  });
});

describe('comandoNoEscopoDoContainer (RN-669)', () => {
  const noContainer = (cmd: string, cwd?: string) =>
    comandoNoEscopoDoContainer(parseCommand(cmd), cwd, RAIZ);

  it('/work, os .worktrees e o /tmp do container estão dentro', () => {
    expect(noContainer('ls /work/src')).toBe(true);
    expect(
      noContainer(
        'cat /work/.worktrees/dev-api/x',
        `${RAIZ}/.worktrees/dev-api`,
      ),
    ).toBe(true);
    expect(noContainer('npm test > /tmp/saida.txt', RAIZ)).toBe(true);
    expect(noContainer('ls ../../src', `${RAIZ}/.worktrees/dev-api`)).toBe(
      true,
    );
  });

  it('fora de /work e /tmp segue fora — inclusive `..` que escapa do /tmp', () => {
    expect(noContainer('cat /etc/passwd')).toBe(false);
    expect(noContainer('ls /tmp/../etc')).toBe(false);
    expect(noContainer('ls /workspace/apps')).toBe(false);
    expect(noContainer('ls', '/data/project-workspaces/proj-2')).toBe(false);
  });
});

describe('comandoNoEscopo com várias raízes', () => {
  it('cada caminho precisa estar em ALGUMA raiz; nenhum pode ficar fora de todas', () => {
    const raizes = ['/work', '/tmp'];
    expect(
      comandoNoEscopo(parseCommand('cp /work/a /tmp/b'), '/work', raizes),
    ).toBe(true);
    expect(
      comandoNoEscopo(parseCommand('cp /work/a /etc/b'), '/work', raizes),
    ).toBe(false);
  });
});

describe('PONTO_DE_MONTAGEM_DO_CONTAINER é cópia travada da porta de Docker', () => {
  it('bate com `PONTO_DE_MONTAGEM` de packages/docker-port', () => {
    const fonte = readFileSync(
      join(__dirname, '../../../../../packages/docker-port/src/docker-port.ts'),
      'utf8',
    );
    const casou = /export const PONTO_DE_MONTAGEM = '([^']+)'/.exec(fonte);
    expect(casou?.[1]).toBe(PONTO_DE_MONTAGEM_DO_CONTAINER);
  });
});
