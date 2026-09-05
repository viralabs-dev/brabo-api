import { readdirSync, type Dirent } from 'node:fs';
import {
  baseDeProjetos,
  dentroDaBaseDeProjetos,
  garantirQueryEscalar,
  normalizarSemBarraFinal,
} from './project-workspaces-root';

/**
 * O navegador de pastas servido pela API (RN-504).
 *
 * ## Por que a api passa a listar diretório
 *
 * Até aqui o produto tinha DOIS mecanismos de "procurar pasta", e os dois
 * dependiam do runner: `FolderBrowserModal` navegava pelo canal Phoenix
 * `terminal:<projectId>` (`fs_list_dir`/`fs_home_dir`, o processo do usuário
 * lendo o disco DELE), e o `RunnerOnboardingPanel` usava
 * `showDirectoryPicker`, que devolve um handle do navegador e nunca um
 * caminho absoluto. Com o modo `runner` saindo da criação de projeto, o
 * navegador fica sem nenhum dos dois — e o modo `mounted` precisa
 * exatamente de um caminho absoluto digitável.
 *
 * Quem passa a responder é a api, que enxerga a base montada por identidade
 * (ADR 0141): o que ela lê aqui é o MESMO caminho que o usuário vê no host,
 * e é o mesmo que vai para `projects.workspace_path`.
 *
 * ## A contenção
 *
 * Servir listagem de diretório a partir de um parâmetro do cliente é, por
 * construção, um vetor de leitura arbitrária. A contenção é UMA e é dura: o
 * caminho tem que estar dentro de `BRABO_PROJECTS_BASE`
 * (`dentroDaBaseDeProjetos`, RN-500), e sair disso é recusa, nunca uma
 * listagem parcial. Sem base configurada não existe pasta alguma para
 * navegar — e isso não é erro, é a instalação dizendo que não oferece o modo
 * Pasta montada.
 *
 * Os tetos vêm junto e todos pelo mesmo motivo — a rota não pode virar um
 * amplificador nem um raio-x da máquina do operador:
 *
 * - **só diretório em `entries`.** O que se escolhe aqui é uma PASTA; nome
 *   de arquivo é conteúdo do projeto de alguém e não ajuda a escolher nada;
 * - **`arquivos` e `simbolicos` ao lado.** Excluir sem contar faria uma
 *   pasta cheia de código, ou cheia de links, parecer VAZIA na tela — a tela
 *   afirmaria sobre o que não leu (a régua da RN-180);
 * - **teto de `TETO_DE_ENTRADAS`, com `truncado` explícito.** Ordena antes
 *   de cortar, para o corte ser determinístico e não "as 500 que o
 *   filesystem devolveu primeiro";
 * - **sem recursão.** Um nível por chamada; descer é outra chamada, do
 *   usuário, com a mesma contenção aplicada de novo;
 * - **não desce em symlink.** `readdirSync(withFileTypes)` tem semântica de
 *   `lstat` — ele reporta o LINK, nunca o alvo —, então um link para fora da
 *   base nunca vira porta de saída. Conta em `simbolicos` e segue;
 * - **entradas começadas com `.` ficam de fora.** `.ssh`, `.aws`, `.env` são
 *   justamente o que não interessa a um seletor de pasta de projeto.
 *
 * **Sem POST.** Criar pasta é da materialização do workspace montado, no
 * momento em que o container sobe — nunca do seletor.
 */

/**
 * Quantos diretórios uma listagem devolve, no máximo.
 *
 * Constante nomeada e não número solto porque ela aparece em três lugares que
 * têm que concordar: o corte aqui, a asserção do teste e a descrição da rota
 * no OpenAPI. O valor é generoso para o caso real (uma pasta de projetos com
 * dezenas de repositórios) e pequeno o bastante para que a resposta não vire
 * despejo de um `/nix/store` da vida.
 */
export const TETO_DE_ENTRADAS = 500;

/** O que a rota devolve — ver `ProjectFoldersResponseDto` para a prosa do contrato. */
export interface ListagemDePastasDeProjeto {
  base: string | null;
  path: string | null;
  entries: string[];
  truncado: boolean;
  arquivos: number;
  simbolicos: number;
}

/**
 * O caminho pedido não está dentro da base — 400, e NÃO 403.
 *
 * A distinção importa e é deliberada: 403 diria "você não tem permissão para
 * ver isto", e sugeriria que outro papel veria. Não é o caso — não existe
 * papel nenhum que navegue fora da base, porque fora da base não é uma área
 * mais privilegiada, é uma área que esta rota simplesmente não endereça. O
 * pedido está MALFORMADO, e 400 é o que diz isso.
 */
export class PastaForaDaBaseError extends Error {
  constructor(
    readonly caminho: string,
    readonly base: string | null,
  ) {
    super(
      base === null
        ? `Não há base de projetos montados nesta instalação, então não existe ` +
            `pasta alguma para navegar — ${JSON.stringify(caminho)} está fora ` +
            `de qualquer escopo que esta rota alcance. Configure ` +
            `BRABO_PROJECTS_BASE (ver docs/runbook.md) e suba a api e o engine ` +
            `de novo.`
        : `A pasta ${JSON.stringify(caminho)} está fora da base de projetos ` +
            `(${base}). O navegador de pastas só enxerga o que está DENTRO da ` +
            `base — é a única pasta do seu computador que os containers do ` +
            `Brabo veem (ADR 0141).`,
    );
    this.name = 'PastaForaDaBaseError';
  }
}

/**
 * A pasta está dentro da base, mas a api não conseguiu abri-la.
 *
 * UM erro para os DOIS motivos (não existe / existe e não dá para ler), com o
 * motivo escrito na mensagem. Separá-los em status diferentes contaria ao
 * cliente qual é qual, e "existe mas você não lê" é informação sobre o disco
 * do operador que a resposta não precisa dar. O que a mensagem precisa fazer
 * é ensinar o que fazer a respeito, e ela faz.
 */
export class PastaNaoLegivelError extends Error {
  constructor(
    readonly caminho: string,
    readonly codigo: string,
  ) {
    super(
      codigo === 'ENOENT' || codigo === 'ENOTDIR'
        ? `A pasta ${JSON.stringify(caminho)} não existe do lado de dentro da api.`
        : `A pasta ${JSON.stringify(caminho)} existe, mas a api não consegue ` +
            `lê-la (${codigo}). Confira o dono e a permissão da pasta no host: ` +
            `as imagens rodam com usuário non-root (ADR 0024).`,
    );
    this.name = 'PastaNaoLegivelError';
  }
}

/**
 * O `path` que chegou pela query, aceito ou recusado — sem tocar disco.
 *
 * `..` e `.` são RECUSADOS em vez de resolvidos, pela mesma razão de
 * `caminhoDeWorkspaceLocalValido`: resolver aceitaria que o caminho pedido
 * não é o caminho lido, e quem digitou não confere o que não consegue ler.
 * `dentroDaBaseDeProjetos` roda depois e sozinha já barraria o escape (ela
 * normaliza antes de comparar) — as duas juntas são de propósito, porque a
 * segunda é a que pega a armadilha de prefixo (`/home/voce/brabo2` NÃO está
 * dentro de `/home/voce/brabo`) e a primeira é a que mantém honesto o
 * caminho que volta na resposta.
 */
function alvoDaListagem(bruto: string): string {
  const base = baseDeProjetos();
  const recusar = () => {
    throw new PastaForaDaBaseError(bruto, base);
  };

  if (bruto.includes('\0')) recusar();
  if (!bruto.startsWith('/')) recusar();
  if (bruto.split('/').some((s) => s === '..' || s === '.')) recusar();

  const normalizado = normalizarSemBarraFinal(bruto);
  if (!dentroDaBaseDeProjetos(normalizado)) recusar();

  return normalizado;
}

/**
 * Lista as SUBPASTAS de `pathPedido` — ou da base, quando ele é omitido.
 *
 * `pathPedido` chega de `@Query('path')`, então pode chegar como ARRAY
 * (`?path=a&path=b`), e o `ValidationPipe` global não intercepta primitivo
 * nativo: `garantirQueryEscalar` é a MESMA guarda da RN-127 que
 * `caminhoDeRepositorioContido` usa, e está aqui pelo mesmo motivo — um array
 * atravessaria `.startsWith`/`.split` com semântica que não é a de string.
 */
export function listarPastasDeProjeto(
  pathPedido?: string | string[],
): ListagemDePastasDeProjeto {
  const base = baseDeProjetos();
  const escalar = garantirQueryEscalar(
    pathPedido,
    () => new PastaForaDaBaseError(JSON.stringify(pathPedido), base),
  );
  const bruto = (escalar ?? '').trim();

  // Sem `path` e sem base não há o que navegar, e isso NÃO é erro: é a
  // instalação dizendo que não oferece o modo Pasta montada. O assistente de
  // criação lê `base: null` e esconde o modo, sem endpoint extra e sem
  // aprender isso por um 4xx.
  if (bruto.length === 0 && base === null) {
    return {
      base: null,
      path: null,
      entries: [],
      truncado: false,
      arquivos: 0,
      simbolicos: 0,
    };
  }

  const alvo = bruto.length === 0 ? base! : alvoDaListagem(bruto);

  let itens: Dirent[];
  try {
    itens = readdirSync(alvo, { withFileTypes: true });
  } catch (erro) {
    const codigo =
      erro !== null && typeof erro === 'object' && 'code' in erro
        ? String((erro as { code: unknown }).code)
        : 'EUNKNOWN';
    throw new PastaNaoLegivelError(alvo, codigo);
  }

  const entries: string[] = [];
  let arquivos = 0;
  let simbolicos = 0;

  for (const item of itens) {
    if (item.name.startsWith('.')) continue;
    // O símbolo vem ANTES de `isDirectory()` de propósito: um link para uma
    // pasta responde `false` a `isDirectory()` no Dirent (semântica de
    // `lstat`), mas a ordem torna a intenção explícita para quem lê — não
    // descemos em link, aconteça o que acontecer com o alvo dele.
    if (item.isSymbolicLink()) {
      simbolicos++;
      continue;
    }
    if (item.isDirectory()) entries.push(item.name);
    else arquivos++;
  }

  // Ordena ANTES de cortar: sem isso, "as 500 primeiras" seria a ordem que o
  // filesystem devolveu, que muda entre máquinas e entre chamadas.
  entries.sort((a, b) => a.localeCompare(b));
  const truncado = entries.length > TETO_DE_ENTRADAS;

  return {
    base,
    path: alvo,
    entries: truncado ? entries.slice(0, TETO_DE_ENTRADAS) : entries,
    truncado,
    arquivos,
    simbolicos,
  };
}
