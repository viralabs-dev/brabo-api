import { accessSync, constants, statSync, type Stats } from 'node:fs';
import { join, posix } from 'node:path';
import {
  dentroDoEscopo,
  normalizarCaminho,
} from '../../domain/actions/path-scope';
import type { ProjectWorkspaceLocation } from '../../domain/iam/project.entity';

/**
 * A raiz dos workspaces de projeto no disco, compartilhada com o engine pelo
 * mesmo volume (ver `PROJECT_WORKSPACES_ROOT` em configuration.md).
 *
 * Existe como função única porque DOIS consumidores dependem dela concordarem:
 * o `permissions.json` é lido de `<raiz>/<workspace_dir_name>/permissions.json`,
 * e o escopo de caminho do ADR 0055 autoriza comandos sob
 * `<raiz>/<workspace_dir_name>`. Se as duas derivações divergissem, a política
 * seria lida de um lugar e aplicada a outro — falha silenciosa e difícil de
 * enxergar.
 *
 * As duas derivações se SEPARARAM em um ponto (RN-478), e a fonte continua
 * única: no modo `runner` o `permissions.json` fica na raiz gerenciada
 * enquanto o escopo aponta para a pasta do host — ver `permissionsFilePath`,
 * que mora ao lado de `projectScopeRoot` justamente por isso.
 *
 * `<workspace_dir_name>` (RN-109) é o nome de pasta CONGELADO na criação do
 * projeto — `<slug>-<8 chars do id>` para projeto novo, o UUID puro (o que já
 * era verdade no disco) para projeto de antes desta coluna existir. O engine
 * concorda porque lê a MESMA coluna do MESMO banco
 * (`Engine.Projects.Project.workspace_dir_name/1`), nunca recomputando o nome
 * a partir do id — as duas derivações são, na prática, a mesma leitura.
 */
export function projectWorkspacesRoot(): string {
  return process.env.PROJECT_WORKSPACES_ROOT ?? '/tmp/brabo-project-workspaces';
}

/**
 * A BASE dos projetos no modo `mounted` — a ÚNICA pasta do computador do
 * operador que os containers do Brabo enxergam (ADR 0141, RN-500).
 *
 * `BRABO_PROJECTS_BASE` é montada por IDENTIDADE (`$X:$X`) nos serviços `api`
 * e `engine`, então o caminho lido aqui é o MESMO no host e nos dois
 * containers. É isso que mantém honesta a string que o usuário digita e que a
 * tela mostra de volta (`projects.workspace_path`), e é o que faz
 * `projectScopeRoot` e `Engine.Actions.Workspace.workspace_dir/2` continuarem
 * valendo sem uma linha de código nova.
 *
 * VARIÁVEL PRÓPRIA, e não `PROJECT_WORKSPACES_ROOT`/`PROJECT_WORKSPACES_HOST_DIR`,
 * por três motivos que o ADR 0141 detalha e que valem repetir aqui, porque é
 * daqui que sai a tentação de fundir as duas:
 *
 * - **colisão de namespace com consequência real.** A raiz gerenciada é
 *   nomeada por `workspace_dir_name` (UNIQUE); a base é nomeada pelo USUÁRIO.
 *   `<base>/loja` e um projeto `container` com `workspace_dir_name = loja`
 *   cairiam na MESMA pasta, e o `git init` do bootstrap aconteceria dentro do
 *   projeto de outra pessoa. Nada no schema impede: a unicidade é entre
 *   `workspace_dir_name`, nunca contra o basename de `workspace_path`;
 * - **semântica de dono oposta.** `/data/project-workspaces` é do PRODUTO
 *   (descartável em modo `container`); a base é do USUÁRIO;
 * - **a base é navegável, a raiz gerenciada não deve ser.** O navegador de
 *   pastas é escopado à base; conflar exporia o interior de todo projeto
 *   `container`.
 *
 * NUNCA lança, e AUSENTE é estado normal — é assim que uma instalação diz
 * "esta máquina não oferece o modo Pasta montada". Quem consome trata `null`
 * como "não ofereça", nunca como erro.
 */
export function baseDeProjetos(): string | null {
  const bruto = process.env.BRABO_PROJECTS_BASE?.trim() ?? '';
  if (bruto.length === 0) return null;
  return normalizarSemBarraFinal(bruto);
}

/**
 * O caminho está DENTRO da base de projetos montados (RN-500)?
 *
 * Reusa `dentroDoEscopo` — a mesma função que o escopo de terminal do ADR
 * 0055 usa — e não uma comparação de prefixo escrita aqui, porque a armadilha
 * é exatamente a que ela já resolve: `/home/voce/brabo2` **não** está dentro
 * de `/home/voce/brabo`, embora a string comece igual. A própria base conta
 * como dentro.
 *
 * Sem base configurada devolve `false`, e isso não é "recusar por precaução":
 * é a resposta correta à pergunta feita. Não existe pasta alguma dentro de uma
 * base que não existe, e o chamador que precisa distinguir "fora da base" de
 * "não há base" pergunta a `baseDeProjetos()` — que é onde essa distinção mora.
 *
 * NÃO entra em `caminhoDeWorkspaceLocalValido` (esta PR não a toca): aquele
 * predicado roda em toda LEITURA, por `projectScopeRoot`, e um projeto
 * `mounted` legado fora da base passaria a explodir na leitura. A base é regra
 * de CRIAÇÃO e CONVERSÃO; o léxico é para sempre.
 */
export function dentroDaBaseDeProjetos(caminho: string): boolean {
  const base = baseDeProjetos();
  if (base === null) return false;
  return dentroDoEscopo(caminho, base);
}

/**
 * O caminho absoluto de um projeto `mounted`, expresso como o SEGMENTO
 * RELATIVO dele sob a base (RN-503) — `/home/voce/brabo/loja` vira `loja`.
 *
 * Existe por causa de UM invariante, o do ADR 0130: nenhum caminho absoluto
 * atravessa a rede até o broker. Ele é root-equivalente no host e compõe o
 * `-v` a partir das raízes DELE; se a api mandasse `/home/voce/brabo/loja`, a
 * contenção do bind-mount passaria a depender de a api estar correta, que é
 * exatamente a dependência que o broker existe para não ter. O que atravessa
 * é o pedaço que a base não cobre, e a base é do outro lado.
 *
 * Devolve um RESULTADO, nunca `null`: "não há base configurada", "o caminho
 * está fora da base" e "o caminho É a base" são três recusas com conserto
 * diferente, e colapsá-las num `null` obrigaria quem lê a adivinhar qual foi.
 * O caso `caminho === base` é recusa e não segmento vazio de propósito —
 * montar a base inteira daria ao container de UM projeto a pasta de todos.
 */
export function segmentoSobABaseDeProjetos(
  caminho: string,
): { ok: true; segmento: string } | { ok: false; motivo: string } {
  const base = baseDeProjetos();
  if (base === null) {
    return {
      ok: false,
      motivo:
        'esta instalação não tem BRABO_PROJECTS_BASE configurada, então não ' +
        'existe base sob a qual expressar a pasta deste projeto',
    };
  }

  const normalizado = normalizarSemBarraFinal(caminho);
  if (normalizado === base) {
    return {
      ok: false,
      motivo:
        `a pasta do projeto é a PRÓPRIA base (${base}) — montá-la daria a ` +
        'este container a pasta de todos os projetos montados',
    };
  }

  if (!dentroDoEscopo(normalizado, base)) {
    return {
      ok: false,
      motivo:
        `a pasta do projeto (${normalizado}) está fora da base ` +
        `${base}. Só o que mora dentro dela é alcançável pelo daemon do ` +
        'servidor, porque é ela que está montada por identidade',
    };
  }

  return { ok: true, segmento: normalizado.slice(base.length + 1) };
}

/**
 * Quantos caracteres do id entram no nome da pasta — mesma convenção do
 * rótulo de sessão (`apps/web/src/lib/session-label.ts`), reusada aqui só
 * pela consistência do número, não pelo código.
 */
const CARACTERES_DO_ID_NO_NOME = 8;

/**
 * O nome de pasta de um projeto NOVO (RN-109): `<slug>-<8 chars do id>` —
 * legível (o slug já é kebab-case, validado no DTO) e único mesmo entre dois
 * workspaces com o mesmo slug, porque `PROJECT_WORKSPACES_ROOT` é UMA raiz
 * para a instância inteira, compartilhada entre TODOS os workspaces.
 *
 * CONGELADO no momento da criação — quem chama grava o resultado em
 * `projects.workspace_dir_name` e nunca mais recalcula, nem quando o slug
 * muda depois (`UpdateProjectUseCase` não toca esta coluna). Projeto criado
 * ANTES desta função existir tem `workspace_dir_name = id` (backfill da
 * migração), preservando o nome físico que já era verdade no disco.
 */
export function workspaceDirNameFor(id: string, slug: string): string {
  return `${slug}-${id.slice(0, CARACTERES_DO_ID_NO_NOME)}`;
}

/**
 * O nome de pasta chega já resolvido (`projects.workspace_dir_name`) — nunca
 * mais o `projectId` cru. Aqui ele vira SEGMENTO DE CAMINHO, e por isso a
 * forma passou a ser exigida em vez de presumida — a checagem é
 * deliberadamente mais larga que UUID (aceita hex, hífen e sublinhado) para
 * caber tanto no UUID puro (projeto de antes da RN-109) quanto no
 * `<slug>-<id>` legível, e estreita o bastante para que o resultado nunca
 * escape da raiz.
 */
const NOME_DE_PASTA_VALIDO = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * A pasta do projeto — o que o ADR 0055 chama de escopo.
 *
 * Recebe `workspace_dir_name`, não `projectId`: o nome da pasta física é
 * dado (RN-109), congelado na criação, e pode divergir do id quando o
 * projeto é legível (`<slug>-<8 chars>`). Quem chama busca o projeto e passa
 * `project.workspaceDirName` — nunca o id cru.
 *
 * O valor pode chegar de `@Param('projectId')` sem pipe de validação em
 * algum ponto da cadeia (ou de uma coluna do banco, que também não é
 * fronteira de validação): um `workspace_dir_name` como `..%2F..%2Fetc`
 * decodificado vira `../../etc`, e o `join` o resolveria para FORA da raiz
 * sem reclamar. Isso vale para os dois consumidores desta função, e o
 * segundo é o que dói:
 *
 * - o `permissions.json` seria lido e ESCRITO em caminho arbitrário
 *   (`fs-permissions-file-store.ts`);
 * - o escopo de caminho do ADR 0055 (`propose-action.use-case.ts` →
 *   `decide.ts`) autoriza comando de terminal sob esta pasta. Um escopo que
 *   escapa da raiz é a política de aprovação apontando para o lugar errado —
 *   falha de SEGURANÇA, não de arquivo não encontrado.
 *
 * Validar aqui, e não em cada chamador, é a mesma razão que fez esta função
 * existir: as duas derivações (api e engine) têm que concordar, e uma
 * checagem duplicada é uma checagem que um dia diverge.
 *
 * ## Os modos `mounted`/`runner` (RN-169/RN-421, ADR 0072/0104)
 *
 * A partir do ADR 0072 a raiz deixa de ser SEMPRE `join(env, coluna)`. Um
 * projeto `mounted` ou `runner` tem por raiz o caminho absoluto que o
 * usuário digitou, e a consequência é honesta e está escrita no ADR: a
 * contenção estrutural que o `join` dava — "o resultado nunca sai da raiz
 * gerenciada, aconteça o que acontecer com a coluna" — deixa de existir para
 * esses projetos, e o que sobra é a validação da CRIAÇÃO (RN-170/RN-422).
 *
 * Por isso o caminho gravado é REVALIDADO na leitura, e não só na escrita:
 * `caminhoDeWorkspaceLocalValido` é o mesmo predicado LÉXICO que a criação
 * aplica, e roda aqui de novo a cada derivação. Assim uma linha adulterada
 * direto no banco (o único jeito de burlar a criação) não vira escopo de
 * terminal em `/` ou em `/etc`. O que NÃO se revalida aqui é a parte de disco
 * (existe, é gravável): ela é I/O, esta função é chamada em caminho quente e
 * quem chama já trata "não deu para ler" — a checagem de disco é da criação,
 * onde o usuário ainda pode corrigir o que digitou.
 */
export function projectScopeRoot(local: ProjectWorkspaceLocation): string {
  if (local.executionMode !== 'container') {
    const caminho = local.workspacePath ?? '';
    // O banco tem CHECK para o par (modo, caminho), então chegar aqui sem
    // caminho é linha incoerente — e o erro diz isso em vez de devolver `/`.
    // `mounted` e `runner` derivam a raiz da MESMA forma: os dois têm a
    // pasta do usuário como raiz, o que muda entre eles é só QUANDO/QUEM
    // verifica que ela existe de verdade (RN-422/RN-423), não onde ela fica.
    if (!caminhoDeWorkspaceLocalValido(caminho)) {
      throw new LocalizacaoDeProjetoInvalidaError(
        caminho,
        `workspacePath inválido para projeto no modo ${local.executionMode}: ` +
          `${JSON.stringify(caminho)}. A pasta do projeto precisa ser um ` +
          `caminho absoluto, sem ".." no meio, e não pode ser pasta de ` +
          `sistema nem se sobrepor ao checkout do Brabo — é a MESMA régua da ` +
          `criação (RN-422/RN-423), então uma linha que a viola só pode ter ` +
          `sido gravada por fora. Corrija a pasta do projeto em Configurações ` +
          `› Modo de execução e tente de novo.`,
      );
    }
    return normalizarSemBarraFinal(caminho);
  }

  return raizGerenciadaDoProjeto(local.workspaceDirName);
}

const PERMISSOES = 'permissions.json';

/**
 * A pasta do projeto DENTRO da raiz gerenciada (`PROJECT_WORKSPACES_ROOT`) —
 * a metade de `projectScopeRoot` que o modo `container` usa, extraída porque
 * `permissionsFilePath` precisa exatamente dela para o modo `runner`.
 *
 * Extraída, e não copiada: a validação de `workspaceDirName` como SEGMENTO de
 * caminho (o parágrafo grande de `projectScopeRoot`, sobre `..%2F..%2Fetc`)
 * tem que valer nos dois usos, e uma segunda cópia é a cópia que um dia
 * diverge — que é a razão de este arquivo existir.
 */
function raizGerenciadaDoProjeto(workspaceDirName: string): string {
  if (!NOME_DE_PASTA_VALIDO.test(workspaceDirName)) {
    throw new LocalizacaoDeProjetoInvalidaError(
      workspaceDirName,
      `workspaceDirName inválido como segmento de caminho: ${JSON.stringify(workspaceDirName)}`,
    );
  }
  return join(projectWorkspacesRoot(), workspaceDirName);
}

/**
 * ONDE mora o `permissions.json` do projeto — e por que NÃO é sempre
 * `projectScopeRoot` (RN-478).
 *
 * As duas derivações nasceram como uma só, e isso estava certo enquanto os
 * dois modos com pasta de usuário eram bind-mount. Deixou de estar quando o
 * modo `runner` nasceu (RN-423, ADR 0104), porque os dois consumidores da
 * raiz querem coisas OPOSTAS:
 *
 * - o ESCOPO de terminal (ADR 0055, `decide.ts`) quer o caminho DO HOST — é
 *   lá que o comando roda, na máquina do usuário, pelo runner. Trocá-lo pela
 *   raiz gerenciada autorizaria comando numa pasta que não é a do projeto;
 * - o `permissions.json` quer um caminho QUE A API ALCANCE. Ela o lê e o
 *   ESCREVE de dentro do próprio container, e um projeto `runner` é
 *   deliberadamente SEM bind-mount: `/home/voce/dev/loja` simplesmente não
 *   existe ali. `mkdir -p` disparava `EACCES: mkdir '/home'`, e a ativação da
 *   execução (a primeira ESCRITA) devolvia 500. A LEITURA degradava calada
 *   (ENOENT → `EMPTY_PERMISSIONS_FILE`), então o efeito maior atravessou sem
 *   ser visto: em projeto `runner` o arquivo nunca existiu, e `decide()`
 *   sempre caiu em `require_approval` por um arquivo que não estava lá.
 *
 * Por que a raiz GERENCIADA e não o disco do usuário, já que o código está lá:
 * `permissions.json` é POLÍTICA, não código do projeto. Quem a lê é a api,
 * dentro do container dela — o runner nunca a lê (ele recebe comando já
 * aprovado, e o engine não a toca em ponto nenhum). Guardá-la na máquina do
 * usuário a tornaria editável por quem ela restringe, e ilegível justamente
 * quando o runner está desconectado, que é quando a decisão precisa continuar
 * valendo.
 *
 * CUSTO DECLARADO: para projeto `runner`, o arquivo de política deixa de
 * morar ao lado do código. Quem procurar `permissions.json` na pasta do
 * projeto não vai achar — ele está em
 * `<PROJECT_WORKSPACES_ROOT>/<workspace_dir_name>/`, chaveado pelo nome que a
 * RN-109 congela na criação (o mesmo que o modo `container` usa, e único
 * mesmo entre workspaces diferentes porque o id é global).
 *
 * `mounted` continua junto do código, e não por descuido: ali a pasta É
 * bind-mount, a api alcança o caminho do host de verdade, e mover o arquivo
 * quebraria projetos que já o têm em disco sem ganhar nada.
 */
export function permissionsFilePath(local: ProjectWorkspaceLocation): string {
  if (local.executionMode === 'runner') {
    return join(raizGerenciadaDoProjeto(local.workspaceDirName), PERMISSOES);
  }
  return join(projectScopeRoot(local), PERMISSOES);
}

/**
 * A localização do projeto gravada no banco não serve como raiz (RN-478).
 *
 * Classe própria, e `motivo` legível em pt-BR, pelo mesmo motivo de
 * `CaminhoLocalInvalidoError` logo abaixo: quem chama precisa distinguir "a
 * linha deste projeto está incoerente" (400, com o que fazer a respeito) de
 * "deu ruim aqui dentro" (500, que não ensina nada e convida a tentar de
 * novo). Eram dois `throw new Error(...)` crus, e a ativação da execução
 * morria em 500 sem corpo útil.
 */
export class LocalizacaoDeProjetoInvalidaError extends Error {
  constructor(
    readonly valor: string,
    readonly motivo: string,
  ) {
    super(motivo);
    this.name = 'LocalizacaoDeProjetoInvalidaError';
  }
}

/**
 * As pastas de sistema que NUNCA podem ser a raiz de um projeto.
 *
 * A lista é curta e mira o que dói: a própria `/`, e as pastas onde estão o
 * sistema operacional do container e os pontos de montagem do produto. O
 * critério não é "arquivo secreto" — é que a raiz do projeto é o ESCOPO que
 * autoriza o terminal do agente (ADR 0055) e o alvo de leitura da aba Code.
 * Um projeto com raiz em `/etc` transforma "o agente pode ler e escrever
 * dentro do projeto dele" em "o agente pode reescrever o container".
 *
 * Vale para a pasta E para tudo abaixo dela: `/etc/meu-projeto` é tão ruim
 * quanto `/etc`, porque escrever ali continua sendo escrever no sistema.
 */
const RAIZES_DE_SISTEMA = [
  '/bin',
  '/boot',
  '/data', // os mounts do produto: bare repos e a raiz gerenciada de workspaces
  '/dev',
  '/etc',
  '/lib',
  '/lib64',
  '/proc',
  '/root',
  '/run',
  '/sbin',
  '/sys',
  '/usr',
  '/var',
];

/**
 * A raiz do checkout do próprio Brabo, vista de dentro deste processo.
 *
 * Não é variável de ambiente nova de propósito: o valor que interessa é onde
 * ESTE processo está rodando, e ele já se conhece. No compose, o serviço `api`
 * tem `working_dir: /workspace` e o monorepo é montado exatamente ali — que é,
 * literalmente, o problema que o ADR 0055 descreve ("dentro do container que
 * executa as ações, `/workspace` é o monorepo do PRÓPRIO Brabo").
 *
 * Se um dia o `cwd` do processo não for a raiz do checkout, a checagem não
 * fica errada: ela continua recusando que a pasta de trabalho da api vire
 * escopo de agente, que é uma recusa correta de qualquer forma.
 */
function raizDoBrabo(): string {
  return posix.normalize(process.cwd());
}

/**
 * `/srv/app//` → `/srv/app`. Sem regex: `\/+$` é a forma que o CodeQL já
 * apontou como ReDoS polinomial (HIGH) neste mesmo produto, e repetir a forma
 * aqui seria reabrir o alerta com outro nome. Um caminho absoluto sempre sobra
 * com a barra inicial, por causa do primeiro segmento vazio do `split`.
 */
export function normalizarSemBarraFinal(caminho: string): string {
  const partes = caminho.split('/').filter((p) => p.length > 0);
  return `/${partes.join('/')}`;
}

/**
 * O predicado LÉXICO do caminho de workspace (RN-170/RN-422) — sem tocar
 * disco.
 *
 * Separado da checagem de disco porque os dois têm tempos de vida diferentes:
 * este vale para sempre (uma raiz em `/etc` é ruim hoje e amanhã) e por isso
 * roda também na LEITURA, em `projectScopeRoot`; o de disco descreve o estado
 * do container agora, e roda só na criação em modo `mounted`, onde o usuário
 * pode corrigir.
 *
 * EXPORTADA (ADR 0104, RN-423): é também o que valida a criação de um
 * projeto `runner` — sem tocar disco, porque só o runner, rodando no host de
 * verdade, tem autoridade para confirmar que a pasta existe. Mesmo predicado
 * nos dois modos: a diferença entre `mounted` e `runner` não é o que conta
 * como caminho válido, é QUANDO/QUEM confirma a parte de disco.
 */
export function caminhoDeWorkspaceLocalValido(caminho: string): boolean {
  if (caminho.length === 0 || caminho.includes('\0')) return false;
  // Absoluto: um caminho relativo dependeria do `cwd` de QUEM resolve, e api e
  // engine são processos diferentes com cwd diferente — a raiz derivada por um
  // não seria a do outro, que é exatamente a falha silenciosa que a função
  // única existe para impedir.
  if (!caminho.startsWith('/')) return false;

  // `..` e `.` são recusados em vez de resolvidos. Resolver seria aceitar que
  // o caminho GRAVADO não é o caminho DIGITADO, e um usuário não confere o que
  // não consegue ler — `/srv/app/../../etc` é `/etc` e não parece.
  const segmentos = caminho.split('/');
  if (segmentos.some((s) => s === '..' || s === '.')) return false;

  const normalizado = normalizarSemBarraFinal(caminho);
  if (normalizado === '/' || normalizado.length === 0) return false;

  if (RAIZES_DE_SISTEMA.some((raiz) => dentroDoEscopo(normalizado, raiz))) {
    return false;
  }

  // Sobreposição com o checkout do Brabo, nos DOIS sentidos. "Conter o
  // repositório" é o caso literal do pedido (`/` ou `/workspace/..`), mas o
  // inverso — a pasta do projeto DENTRO do monorepo — é o problema que o
  // ADR 0055 relata acontecendo de verdade: o agente executando na árvore do
  // próprio produto. Recusar um e permitir o outro seria fechar a porta e
  // deixar a janela.
  const brabo = raizDoBrabo();
  if (
    dentroDoEscopo(normalizado, brabo) ||
    dentroDoEscopo(brabo, normalizado)
  ) {
    return false;
  }

  return true;
}

/**
 * Por que a criação do projeto foi recusada — com a lição junto (RN-170).
 *
 * Classe própria, e `motivo` legível em pt-BR, porque esta mensagem é o
 * produto: um caminho que não está montado no container produz um projeto que
 * TRAVA depois, na primeira ação do primeiro agente, longe da tela onde a
 * decisão foi tomada. Recusar na criação com a instrução de como montar é a
 * diferença entre "não funcionou" e "não funcionou, e é isto que falta".
 */
export class CaminhoLocalInvalidoError extends Error {
  constructor(
    readonly caminho: string,
    readonly motivo: string,
  ) {
    super(motivo);
    this.name = 'CaminhoLocalInvalidoError';
  }
}

/**
 * Como montar a pasta — a metade da mensagem que ENSINA.
 *
 * Repete o caminho pedido de propósito: quem digitou vê o valor exato que a
 * api enxergou, que é diferente do que ele vê no host quando o mount não
 * existe.
 */
function comoMontar(caminho: string): string {
  return (
    `A pasta precisa estar montada DENTRO dos containers da api e do engine, ` +
    `no MESMO caminho absoluto (${caminho}) — a api e o engine escrevem no ` +
    `mesmo lugar, e um caminho que só existe no host não existe para nenhum ` +
    `dos dois. No docker/docker-compose.yml, acrescente a mesma linha aos ` +
    `serviços "api" e "engine": ` +
    `"- ${caminho}:${caminho}". Depois: docker compose up -d api engine. ` +
    `Ver docs/runbook.md, seção "Projeto no modo Local".`
  );
}

/**
 * A guarda da criação de um projeto no modo Local (RN-170).
 *
 * Devolve o caminho NORMALIZADO — é ele que vai para o banco, e não o
 * original, pelo mesmo motivo de `caminhoDeRepositorioContido` devolver o
 * normalizado: gravar uma string e ter validado outra é como a validação
 * deixa de valer no dia seguinte.
 *
 * Toca disco de propósito, e é a única função deste arquivo que toca. As três
 * perguntas — existe? é pasta? dá para escrever? — não têm resposta léxica, e
 * são justamente as que separam "vai funcionar" de "vai travar no primeiro
 * turno do primeiro agente". `access(W_OK)` responde pelo usuário do PROCESSO,
 * que é o que importa: as imagens de produção rodam non-root (ADR 0024), e uma
 * pasta do host montada com dono diferente é legível e não gravável.
 */
export function validarCaminhoDeWorkspaceLocal(caminho: string): string {
  const bruto = caminho.trim();

  if (!caminhoDeWorkspaceLocalValido(bruto)) {
    throw new CaminhoLocalInvalidoError(
      bruto,
      `Caminho inválido para um projeto Local: ${JSON.stringify(bruto)}. ` +
        `Ele precisa ser absoluto (começar com "/"), sem ".." no meio, e não ` +
        `pode ser a raiz do sistema, uma pasta do sistema (${RAIZES_DE_SISTEMA.join(', ')}) ` +
        `nem se sobrepor ao checkout do próprio Brabo — o agente executando na ` +
        `árvore do produto é o problema que o container veio resolver (ADR 0055).`,
    );
  }

  const normalizado = normalizarSemBarraFinal(bruto);

  // O tipo é explícito porque `let` sem anotação nasce `any` implícito: a
  // atribuição acontece DENTRO do try, e o TypeScript não propaga de lá o tipo
  // para a declaração. Sem isto, `info.isDirectory()` vira chamada em `any` — a
  // checagem de "é pasta?" deixa de ser verificada pelo compilador, e o ESLint
  // do CI (que roda sobre `src/`, sem `--fix`) reprova.
  let info: Stats;
  try {
    info = statSync(normalizado);
  } catch {
    throw new CaminhoLocalInvalidoError(
      normalizado,
      `A pasta ${normalizado} não existe do lado de dentro da api. ${comoMontar(normalizado)}`,
    );
  }

  if (!info.isDirectory()) {
    throw new CaminhoLocalInvalidoError(
      normalizado,
      `${normalizado} existe mas não é uma pasta. O projeto Local aponta para ` +
        `a PASTA onde o código mora, não para um arquivo.`,
    );
  }

  try {
    accessSync(normalizado, constants.W_OK | constants.X_OK);
  } catch {
    throw new CaminhoLocalInvalidoError(
      normalizado,
      `A pasta ${normalizado} existe dentro da api, mas o processo não pode ` +
        `escrever nela. Confira o dono e a permissão da pasta no host: as ` +
        `imagens rodam com usuário non-root (ADR 0024), então uma pasta do ` +
        `host com outro dono chega montada como somente leitura na prática. ` +
        `${comoMontar(normalizado)}`,
    );
  }

  return normalizado;
}

/**
 * Caminho de LEITURA recusado por sair do escopo do projeto (RN-095).
 *
 * Classe própria, e não `Error` cru, porque quem chama precisa distinguir "o
 * cliente pediu coisa inválida" (400) de "deu ruim aqui dentro" (500) — e um
 * `Error` genérico vira 500, que ensina o cliente a tentar de novo.
 */
export class CaminhoForaDoEscopoError extends Error {
  constructor(readonly caminho: string) {
    super(`caminho fora do escopo do projeto: ${JSON.stringify(caminho)}`);
    this.name = 'CaminhoForaDoEscopoError';
  }
}

/**
 * Recusa um parâmetro de query que chegou como ARRAY em vez de string
 * (RN-127).
 *
 * `@Query('ref') ref?: string` e `@Query('path') path?: string` extraem o
 * valor cru sem DTO/`class-validator` no meio — e o `ValidationPipe` global
 * (`main.ts`) não ajuda aqui: ele pula tipo primitivo nativo (`String`) por
 * desenho do Nest, então nada intercepta `ref`/`path` antes deles chegarem
 * como argumento de método. O Express entrega `?ref=a&ref=b` como ARRAY, e a
 * anotação `string` do TypeScript só existe em compile-time — em runtime, um
 * array passa incólume por `.includes()` (semântica de elemento exato, não
 * substring) e por `RegExp.test()` (chama `.toString()` no array antes de
 * casar), então um valor como `['x/../y']` escaparia da checagem de `..`
 * mesmo contendo `..`.
 *
 * Central aqui porque os DOIS lugares que tratam query como string têm o
 * MESMO problema: `caminhoDeRepositorioContido` logo abaixo (`path`) e
 * `ReadProjectCodeUseCase.alvo` (`ref`) — checagem duplicada é checagem que
 * um dia diverge, mesmo motivo do resto deste arquivo.
 */
export function garantirQueryEscalar<T>(
  valor: T | T[],
  criarErro: () => Error,
): T {
  if (Array.isArray(valor)) throw criarErro();
  return valor;
}

/**
 * O caminho de arquivo que o CLIENTE pediu, contido na pasta do projeto
 * (RN-095, FASE 26b).
 *
 * ## Por que aqui, e não uma checagem por rota
 *
 * A aba Code tem quatro rotas de leitura e três delas recebem caminho do
 * cliente. Escrever a contenção em cada uma seria escrever a mesma regra três
 * vezes, e o CLAUDE.md já registra o preço disso na PÓS-FASE 15: *"duplicá-la
 * em cada chamador seria checagem que um dia diverge"*. Então ela mora onde a
 * contenção de caminho do produto JÁ morava — ao lado de `projectScopeRoot`,
 * que é a RN-092 — e reusa as mesmas primitivas do escopo de terminal
 * (`normalizarCaminho`/`dentroDoEscopo`, ADR 0055) em vez de normalizar de um
 * jeito novo.
 *
 * O preço conhecido é o painel: o CodeQL não enxerga barreira que mora em
 * outra função, e isso já foi decidido e pago uma vez (os três
 * `js/path-injection` da PÓS-FASE 15). A decisão não mudou.
 *
 * ## O que ela recusa, e por quê
 *
 * O caminho chega por query string, e o Express já decodificou o
 * percent-encoding: `..%2F..%2Fetc` chega como `../../etc`. Ancorado na raiz
 * do projeto e normalizado, ele sai da raiz — e sair é a recusa.
 *
 * Caminho ABSOLUTO também é recusado, inclusive quando o mesmo nome existiria
 * dentro do repositório (`/apps/api`). Reinterpretar a barra inicial como
 * "relativo à raiz" seria conveniente e errado pelo mesmo motivo que o retorno
 * normalizado existe: conferir uma string e usar outra. O caminho de
 * repositório é relativo por contrato (`ListTreeInput.path`), e um 400 dizendo
 * isso é mais claro que uma conversão silenciosa.
 *
 * Isso importa nos três providers, por motivos DIFERENTES, o que é justamente
 * o argumento para conter aqui em cima e não confiar no de baixo:
 *
 * - **github/gitlab**: o caminho vira segmento de URL da API do provider
 *   (`/repos/:owner/:repo/contents/<path>`). Um `../../` ali não lê arquivo
 *   nenhum: ele troca de ENDPOINT, e a credencial usada é a do owner do
 *   workspace (RN-058/RN-082);
 * - **local**: vira o lado direito de `git show <ref>:<path>` num bare repo.
 *
 * ## O que ela devolve
 *
 * O caminho relativo à raiz do repositório, já normalizado — `""` para a raiz.
 * Devolver o normalizado (e não o original) é o que impede o chamador de
 * validar uma string e usar outra.
 */
export function caminhoDeRepositorioContido(
  local: ProjectWorkspaceLocation,
  caminho: string | undefined,
): string {
  // Array antes de tudo (RN-127) — `.includes('\0')` logo abaixo também
  // teria semântica de array em vez de string, e escaparia a mesma checagem.
  const escalar = garantirQueryEscalar(
    caminho,
    () => new CaminhoForaDoEscopoError(JSON.stringify(caminho)),
  );
  const bruto = escalar ?? '';
  // Byte NUL trunca o caminho em qualquer API que atravesse C, e nenhuma
  // normalização de string o enxerga — por isso a recusa vem antes dela.
  if (bruto.includes('\0')) throw new CaminhoForaDoEscopoError(bruto);

  const raiz = projectScopeRoot(local);
  const absoluto = normalizarCaminho(bruto, raiz);
  if (!dentroDoEscopo(absoluto, raiz))
    throw new CaminhoForaDoEscopoError(bruto);

  // `normalizarCaminho` devolve absoluto; a leitura é relativa ao repositório.
  // A raiz do projeto é o próprio prefixo, então tirá-lo é seguro DEPOIS de
  // `dentroDoEscopo` — que é quem garantiu que o prefixo está lá.
  //
  // Sem regex de propósito: `path-scope.ts` já trocou `\/+$` por um laço
  // depois de o CodeQL apontar ReDoS polinomial (HIGH), e repetir a forma
  // aqui seria reabrir o mesmo alerta com outro nome.
  const relativo = absoluto.slice(raiz.length);
  let inicio = 0;
  while (inicio < relativo.length && relativo[inicio] === '/') inicio++;
  return relativo.slice(inicio);
}
