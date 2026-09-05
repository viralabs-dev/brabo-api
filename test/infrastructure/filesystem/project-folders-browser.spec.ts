import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  listarPastasDeProjeto,
  PastaForaDaBaseError,
  PastaNaoLegivelError,
  TETO_DE_ENTRADAS,
} from '../../../src/infrastructure/filesystem/project-folders-browser';

/**
 * O navegador de pastas da api (RN-504).
 *
 * Contra o disco DE VERDADE, em `mkdtemp`, e não contra um `fs` mockado. O
 * que este arquivo precisa provar — que um symlink é contado e nunca
 * descido, que `readdir(withFileTypes)` tem semântica de `lstat`, que uma
 * pasta que não existe vira erro tipado — é comportamento do sistema de
 * arquivos, e um dublê provaria só que o dublê concorda com o que quem
 * escreveu o teste imaginou.
 *
 * A base sai de `BRABO_PROJECTS_BASE` apontada para o tmpdir, restaurada no
 * `afterEach` (mesmo cuidado do `project-workspaces-root.spec.ts` irmão).
 */

let raiz: string;
let base: string;
const originalBase = process.env.BRABO_PROJECTS_BASE;

beforeAll(() => {
  raiz = mkdtempSync(join(tmpdir(), 'brabo-folders-'));
  base = join(raiz, 'brabo');
  mkdirSync(base);
});

afterAll(() => {
  rmSync(raiz, { recursive: true, force: true });
});

afterEach(() => {
  if (originalBase === undefined) delete process.env.BRABO_PROJECTS_BASE;
  else process.env.BRABO_PROJECTS_BASE = originalBase;
});

function comBase() {
  process.env.BRABO_PROJECTS_BASE = base;
}

describe('listarPastasDeProjeto — escopo (RN-504)', () => {
  it('sem `path`, lista a própria base e a devolve como `path`', () => {
    comBase();
    mkdirSync(join(base, 'loja'), { recursive: true });

    const r = listarPastasDeProjeto();

    expect(r.base).toBe(base);
    expect(r.path).toBe(base);
    expect(r.entries).toContain('loja');
  });

  it('recusa `..` — resolver aceitaria que o caminho pedido não é o caminho lido', () => {
    comBase();
    expect(() => listarPastasDeProjeto(`${base}/../..`)).toThrow(
      PastaForaDaBaseError,
    );
    expect(() => listarPastasDeProjeto(`${base}/loja/../../etc`)).toThrow(
      PastaForaDaBaseError,
    );
  });

  it('recusa caminho absoluto fora da base', () => {
    comBase();
    expect(() => listarPastasDeProjeto('/etc')).toThrow(PastaForaDaBaseError);
    expect(() => listarPastasDeProjeto(raiz)).toThrow(PastaForaDaBaseError);
  });

  it('recusa caminho RELATIVO — a rota só endereça caminho absoluto', () => {
    comBase();
    expect(() => listarPastasDeProjeto('brabo/loja')).toThrow(
      PastaForaDaBaseError,
    );
  });

  it('a ARMADILHA DE PREFIXO: `<base>2` não está dentro de `<base>`', () => {
    comBase();
    const vizinho = `${base}2`;
    mkdirSync(vizinho, { recursive: true });
    mkdirSync(join(vizinho, 'segredo'), { recursive: true });

    // A string começa igual, e é exatamente por isso que a comparação de
    // prefixo escrita à mão erraria aqui. `dentroDaBaseDeProjetos` reusa
    // `dentroDoEscopo`, que exige a barra.
    expect(() => listarPastasDeProjeto(vizinho)).toThrow(PastaForaDaBaseError);

    rmSync(vizinho, { recursive: true, force: true });
  });

  it('recusa `path` que chega como ARRAY (RN-127)', () => {
    comBase();
    // `?path=a&path=b` chega assim do Express, e nada intercepta antes: a
    // anotação `string` só existe em compile-time.
    expect(() => listarPastasDeProjeto([base, '/etc'])).toThrow(
      PastaForaDaBaseError,
    );
  });

  it('recusa byte NUL, que trunca o caminho em qualquer API que atravesse C', () => {
    comBase();
    expect(() => listarPastasDeProjeto(`${base}\0/etc`)).toThrow(
      PastaForaDaBaseError,
    );
  });

  it('a própria base conta como dentro dela', () => {
    comBase();
    expect(() => listarPastasDeProjeto(base)).not.toThrow();
  });
});

describe('listarPastasDeProjeto — sem base configurada (RN-504)', () => {
  it('sem `path`: devolve `base: null` e `path: null`, SEM lançar', () => {
    delete process.env.BRABO_PROJECTS_BASE;

    const r = listarPastasDeProjeto();

    // Ausente é estado NORMAL — é assim que o assistente de criação aprende
    // a esconder o modo Pasta montada, sem endpoint extra e sem 4xx.
    expect(r).toEqual({
      base: null,
      path: null,
      entries: [],
      truncado: false,
      arquivos: 0,
      simbolicos: 0,
    });
  });

  it('com `path`: é recusa, porque não existe base que o contenha', () => {
    delete process.env.BRABO_PROJECTS_BASE;
    expect(() => listarPastasDeProjeto('/home/voce/brabo')).toThrow(
      PastaForaDaBaseError,
    );
  });
});

describe('listarPastasDeProjeto — tetos (RN-504)', () => {
  it('só diretório entra em `entries`; arquivo é CONTADO, nunca listado', () => {
    comBase();
    const pasta = join(base, 'com-arquivos');
    mkdirSync(pasta, { recursive: true });
    mkdirSync(join(pasta, 'src'));
    writeFileSync(join(pasta, 'package.json'), '{}');
    writeFileSync(join(pasta, 'README.md'), '#');

    const r = listarPastasDeProjeto(pasta);

    expect(r.entries).toEqual(['src']);
    // Sem esta contagem, uma pasta cheia de código chegaria como lista de um
    // item só e a tela não teria como dizer o que ficou de fora (RN-180).
    expect(r.arquivos).toBe(2);
  });

  it('entrada começada com `.` fica de fora, e nem é contada', () => {
    comBase();
    const pasta = join(base, 'com-ocultos');
    mkdirSync(pasta, { recursive: true });
    mkdirSync(join(pasta, '.git'));
    writeFileSync(join(pasta, '.env'), 'SEGREDO=1');
    mkdirSync(join(pasta, 'visivel'));

    const r = listarPastasDeProjeto(pasta);

    expect(r.entries).toEqual(['visivel']);
    expect(r.arquivos).toBe(0);
    expect(r.simbolicos).toBe(0);
  });

  it('symlink é PULADO e CONTADO — pasta cheia de links não parece vazia', () => {
    comBase();
    const pasta = join(base, 'com-links');
    mkdirSync(pasta, { recursive: true });
    mkdirSync(join(pasta, 'real'));
    // Um link para FORA da base: se descêssemos nele, seria a porta de saída
    // que o escopo existe para fechar.
    symlinkSync(raiz, join(pasta, 'atalho-para-fora'), 'dir');
    symlinkSync(join(pasta, 'real'), join(pasta, 'atalho-interno'), 'dir');

    const r = listarPastasDeProjeto(pasta);

    expect(r.entries).toEqual(['real']);
    expect(r.simbolicos).toBe(2);
    expect(r.arquivos).toBe(0);
  });

  it(`teto de ${TETO_DE_ENTRADAS} entradas marca truncado, e ordena ANTES de cortar`, () => {
    comBase();
    const pasta = join(base, 'muitas');
    mkdirSync(pasta, { recursive: true });
    // Criadas fora de ordem de propósito: o corte tem que ser da lista
    // ORDENADA, não "as primeiras que o filesystem devolveu".
    for (let i = TETO_DE_ENTRADAS + 10; i > 0; i--) {
      mkdirSync(join(pasta, `p${String(i).padStart(4, '0')}`));
    }

    const r = listarPastasDeProjeto(pasta);

    expect(r.truncado).toBe(true);
    expect(r.entries).toHaveLength(TETO_DE_ENTRADAS);
    expect(r.entries[0]).toBe('p0001');
    expect(r.entries[TETO_DE_ENTRADAS - 1]).toBe(
      `p${String(TETO_DE_ENTRADAS).padStart(4, '0')}`,
    );
  });

  it('abaixo do teto, `truncado` é false', () => {
    comBase();
    const pasta = join(base, 'poucas');
    mkdirSync(pasta, { recursive: true });
    mkdirSync(join(pasta, 'a'));

    expect(listarPastasDeProjeto(pasta).truncado).toBe(false);
  });

  it('NÃO desce: a listagem tem um nível só', () => {
    comBase();
    const pasta = join(base, 'aninhada');
    mkdirSync(join(pasta, 'nivel1', 'nivel2'), { recursive: true });

    const r = listarPastasDeProjeto(pasta);

    expect(r.entries).toEqual(['nivel1']);
    expect(r.entries.join()).not.toContain('nivel2');
  });
});

describe('listarPastasDeProjeto — pasta ilegível (RN-504)', () => {
  it('pasta inexistente DENTRO da base é erro tipado, não `Error` cru', () => {
    comBase();
    let capturado: unknown;
    try {
      listarPastasDeProjeto(join(base, 'nunca-existiu'));
    } catch (erro) {
      capturado = erro;
    }

    expect(capturado).toBeInstanceOf(PastaNaoLegivelError);
    expect((capturado as PastaNaoLegivelError).codigo).toBe('ENOENT');
    expect((capturado as Error).message).toContain('não existe');
  });

  it('arquivo (e não pasta) dentro da base também não é listável', () => {
    comBase();
    const arquivo = join(base, 'nao-e-pasta.txt');
    writeFileSync(arquivo, 'oi');

    expect(() => listarPastasDeProjeto(arquivo)).toThrow(PastaNaoLegivelError);
  });
});
