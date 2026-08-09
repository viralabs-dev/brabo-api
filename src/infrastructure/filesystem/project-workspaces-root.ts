import { join } from 'node:path';
import {
  dentroDoEscopo,
  normalizarCaminho,
} from '../../domain/actions/path-scope';

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
 */
export function projectScopeRoot(workspaceDirName: string): string {
  if (!NOME_DE_PASTA_VALIDO.test(workspaceDirName)) {
    throw new Error(
      `workspaceDirName inválido como segmento de caminho: ${JSON.stringify(workspaceDirName)}`,
    );
  }
  return join(projectWorkspacesRoot(), workspaceDirName);
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
  workspaceDirName: string,
  caminho: string | undefined,
): string {
  const bruto = caminho ?? '';
  // Byte NUL trunca o caminho em qualquer API que atravesse C, e nenhuma
  // normalização de string o enxerga — por isso a recusa vem antes dela.
  if (bruto.includes('\0')) throw new CaminhoForaDoEscopoError(bruto);

  const raiz = projectScopeRoot(workspaceDirName);
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
