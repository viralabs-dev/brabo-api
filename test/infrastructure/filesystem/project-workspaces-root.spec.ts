import { mkdtempSync, chmodSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, afterEach } from 'vitest';
import {
  CaminhoForaDoEscopoError,
  CaminhoLocalInvalidoError,
  caminhoDeRepositorioContido,
  caminhoDeWorkspaceLocalValido,
  garantirQueryEscalar,
  projectScopeRoot,
  projectWorkspacesRoot,
  validarCaminhoDeWorkspaceLocal,
  workspaceDirNameFor,
} from '../../../src/infrastructure/filesystem/project-workspaces-root';
import type { ProjectWorkspaceLocation } from '../../../src/domain/iam/project.entity';

/**
 * O projeto no modo de SEMPRE (`container`), montado a partir do nome da
 * pasta — é o que todos os casos herdados deste arquivo exercitam.
 */
function noContainer(workspaceDirName: string): ProjectWorkspaceLocation {
  return { workspaceDirName, executionMode: 'container', workspacePath: null };
}

/** O projeto no modo Pasta montada (RN-169/RN-421): a raiz é o caminho, não o nome. */
function montado(workspacePath: string): ProjectWorkspaceLocation {
  return {
    workspaceDirName: 'checkout-3f2b1c8e',
    executionMode: 'mounted',
    workspacePath,
  };
}

/**
 * O projeto no modo Runner (RN-423): MESMA derivação de raiz de `mounted` —
 * o que muda entre os dois é QUANDO/QUEM verifica o disco, não onde a raiz
 * fica.
 */
function runner(workspacePath: string): ProjectWorkspaceLocation {
  return {
    workspaceDirName: 'checkout-3f2b1c8e',
    executionMode: 'runner',
    workspacePath,
  };
}

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
    expect(() => projectScopeRoot(noContainer(nome))).not.toThrow();
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
    expect(
      projectScopeRoot(noContainer('3f2b1c8e-0a5d-4f6b-9c1e-2d7a8b3c4d5e')),
    ).toBe(
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
    expect(() => projectScopeRoot(noContainer(workspaceDirName))).toThrow(
      /workspaceDirName inválido/,
    );
  });

  it('nenhum id aceito escapa da raiz', () => {
    process.env.PROJECT_WORKSPACES_ROOT = '/var/brabo';
    for (const id of ['abc', 'A-1_b', '0'.repeat(64)]) {
      expect(projectScopeRoot(noContainer(id)).startsWith('/var/brabo/')).toBe(
        true,
      );
    }
  });

  it('a raiz tem default de desenvolvimento e é lida do ambiente', () => {
    expect(projectWorkspacesRoot()).toBe('/tmp/brabo-project-workspaces');
    process.env.PROJECT_WORKSPACES_ROOT = '/var/brabo';
    expect(projectWorkspacesRoot()).toBe('/var/brabo');
  });
});

/**
 * Os modos `mounted`/`runner` (RN-169/RN-421, ADR 0072/0104): a raiz deixa
 * de ser `join(env, coluna)`.
 *
 * Estes casos são a metade LÉXICA da guarda — a que vale para sempre e por
 * isso roda também na leitura. A metade de disco está em
 * `validarCaminhoDeWorkspaceLocal`, logo abaixo, e só se aplica a
 * `mounted` — `runner` não toca disco nem na criação nem na leitura
 * (RN-423).
 */
describe('projectScopeRoot nos modos mounted/runner', () => {
  afterEach(() => {
    delete process.env.PROJECT_WORKSPACES_ROOT;
  });

  it.each([
    ['mounted', montado] as const,
    ['runner', runner] as const,
  ])('%s — caminho feliz: a raiz é a pasta do usuário, não a gerenciada', (_nome, fabrica) => {
    process.env.PROJECT_WORKSPACES_ROOT = '/var/brabo';
    expect(projectScopeRoot(fabrica('/home/voce/projetos/loja'))).toBe(
      '/home/voce/projetos/loja',
    );
  });

  it.each([
    ['mounted', montado] as const,
    ['runner', runner] as const,
  ])('%s — a barra final não muda a raiz — senão o prefixo do escopo mudaria com ela', (_nome, fabrica) => {
    expect(projectScopeRoot(fabrica('/home/voce/projetos/loja/'))).toBe(
      '/home/voce/projetos/loja',
    );
  });

  it.each([
    ['/', 'a raiz do sistema — o escopo do agente seria o container inteiro'],
    ['/etc', 'pasta de sistema'],
    ['/etc/meu-projeto', 'ABAIXO de pasta de sistema — escrever ali é escrever no sistema'],
    ['/data/project-workspaces', 'a raiz gerenciada, que é mount do produto'],
    ['relativo/sem/barra', 'relativo: dependeria do cwd de QUEM resolve'],
    ['/home/voce/../../etc', '`..` no meio: o caminho gravado não é o que se lê'],
    ['', 'vazio'],
  ])('RECUSA %j na derivação (mounted) — %s', (caminho) => {
    expect(() => projectScopeRoot(montado(caminho))).toThrow(
      /workspacePath inválido/,
    );
  });

  it('RECUSA o mesmo léxico em runner — a diferença entre os dois modos não é o que conta como válido', () => {
    expect(() => projectScopeRoot(runner('/home/voce/../../etc'))).toThrow(
      /workspacePath inválido/,
    );
  });

  it('linha incoerente no banco (mounted sem caminho) NÃO vira escopo em `/`', () => {
    // O CHECK do banco impede, mas a derivação é a última barreira: um `null`
    // caindo em `join()` daria `/`, e `/` como escopo de terminal autoriza o
    // container inteiro. Falhar alto é a resposta certa.
    expect(() =>
      projectScopeRoot({
        workspaceDirName: 'checkout-3f2b1c8e',
        executionMode: 'mounted',
        workspacePath: null,
      }),
    ).toThrow(/workspacePath inválido/);
  });

  it('a contenção de caminho da aba Code segue valendo, agora sobre a pasta do usuário', () => {
    const projeto = montado('/home/voce/projetos/loja');
    expect(caminhoDeRepositorioContido(projeto, 'src/main.ts')).toBe(
      'src/main.ts',
    );
    expect(() =>
      caminhoDeRepositorioContido(projeto, '../../etc/passwd'),
    ).toThrow(CaminhoForaDoEscopoError);
  });
});

/**
 * `caminhoDeWorkspaceLocalValido` exportada (ADR 0104, RN-423) — o predicado
 * que valida a criação de um projeto `runner` sem tocar disco. Os casos
 * léxicos já são cobertos indiretamente pelos blocos acima (via
 * `projectScopeRoot`) e por `validarCaminhoDeWorkspaceLocal` abaixo; este
 * bloco prova só que a função é a MESMA usada nos dois lugares.
 */
describe('caminhoDeWorkspaceLocalValido', () => {
  it('aceita o mesmo caminho que validarCaminhoDeWorkspaceLocal aceitaria, sem tocar disco', () => {
    // Uma pasta que não existe no disco: validarCaminhoDeWorkspaceLocal
    // recusaria (I/O), mas o predicado léxico puro aceita — é exatamente a
    // diferença que RN-423 documenta entre `mounted` e `runner`.
    expect(
      caminhoDeWorkspaceLocalValido('/home/voce/projetos/inexistente'),
    ).toBe(true);
  });

  it('recusa o mesmo léxico que RECUSARIA em mounted', () => {
    expect(caminhoDeWorkspaceLocalValido('/')).toBe(false);
    expect(caminhoDeWorkspaceLocalValido('relativo/sem/barra')).toBe(false);
    expect(caminhoDeWorkspaceLocalValido('/home/voce/../../etc')).toBe(false);
  });
});

/**
 * A guarda da CRIAÇÃO (RN-170) — a que toca disco.
 *
 * O caso de RECUSA é o ponto da entrega: um caminho que não está montado no
 * container produz um projeto que trava DEPOIS, longe da tela onde a decisão
 * foi tomada. Por isso os testes conferem também que a mensagem ENSINA — sem
 * a instrução de montagem, a recusa é só um "não".
 */
describe('validarCaminhoDeWorkspaceLocal', () => {
  const criados: string[] = [];

  function pastaTemporaria(): string {
    const dir = mkdtempSync(join(tmpdir(), 'brabo-local-'));
    criados.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of criados.splice(0)) {
      // Restaura a permissão antes de apagar: a pasta sem `w` do teste de
      // recusa não se apaga sozinha.
      try {
        chmodSync(dir, 0o700);
      } catch {
        /* já pode ter sumido */
      }
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('caminho feliz: pasta que existe e é gravável passa, e volta normalizada', () => {
    const dir = pastaTemporaria();
    expect(validarCaminhoDeWorkspaceLocal(`${dir}/`)).toBe(dir);
    // Espaço em volta é erro de digitação, não caminho diferente.
    expect(validarCaminhoDeWorkspaceLocal(`  ${dir}  `)).toBe(dir);
  });

  it('RECUSA pasta que não existe dentro do container, ENSINANDO como montar', () => {
    const dir = pastaTemporaria();
    const inexistente = `${dir}/nao-montada`;

    let erro: unknown;
    try {
      validarCaminhoDeWorkspaceLocal(inexistente);
    } catch (e) {
      erro = e;
    }

    expect(erro).toBeInstanceOf(CaminhoLocalInvalidoError);
    const mensagem = (erro as Error).message;
    expect(mensagem).toContain('não existe do lado de dentro da api');
    // A parte que ENSINA: o caminho exato, o arquivo a editar e a linha.
    expect(mensagem).toContain(inexistente);
    expect(mensagem).toContain('docker/docker-compose.yml');
    expect(mensagem).toContain(`- ${inexistente}:${inexistente}`);
  });

  it('RECUSA pasta que existe mas não é gravável pelo processo', () => {
    const dir = pastaTemporaria();
    chmodSync(dir, 0o500);

    // Rodando como root, `access(W_OK)` responde "pode" mesmo sem o bit — o
    // teste então não teria o que provar, e afirmar o contrário seria mentira.
    let semPermissao = true;
    try {
      writeFileSync(join(dir, 'sonda'), '');
      semPermissao = false;
    } catch {
      semPermissao = true;
    }
    if (!semPermissao) return;

    expect(() => validarCaminhoDeWorkspaceLocal(dir)).toThrow(
      /não pode\s+escrever nela|não pode escrever nela/,
    );
  });

  it('RECUSA arquivo no lugar de pasta', () => {
    const dir = pastaTemporaria();
    const arquivo = join(dir, 'arquivo.txt');
    writeFileSync(arquivo, 'oi');
    expect(() => validarCaminhoDeWorkspaceLocal(arquivo)).toThrow(
      /não é uma pasta/,
    );
  });

  it('RECUSA o checkout do próprio Brabo, nos dois sentidos (ADR 0055)', () => {
    // O `cwd` do processo de teste é o próprio monorepo: é literalmente o
    // problema que o container veio resolver — o agente executando na árvore
    // do produto.
    expect(() => validarCaminhoDeWorkspaceLocal(process.cwd())).toThrow(
      CaminhoLocalInvalidoError,
    );
    // E a pasta que CONTÉM o checkout, que é o caso literal do pedido.
    expect(() =>
      validarCaminhoDeWorkspaceLocal(join(process.cwd(), '..')),
    ).toThrow(CaminhoLocalInvalidoError);
  });

  it.each([
    ['/', 'a raiz do sistema'],
    ['/etc', 'pasta de sistema'],
    ['/usr/local/projetos', 'abaixo de pasta de sistema'],
    ['projetos/loja', 'relativo'],
  ])('RECUSA %j — %s, e diz por quê', (caminho) => {
    expect(() => validarCaminhoDeWorkspaceLocal(caminho)).toThrow(
      /Caminho inválido para um projeto Local/,
    );
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
  const PROJETO = noContainer('3f2b1c8e-0a5d-4f6b-9c1e-2d7a8b3c4d5e');

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
    expect(() =>
      caminhoDeRepositorioContido(noContainer('../../etc'), 'README.md'),
    ).toThrow(/workspaceDirName inválido/);
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
