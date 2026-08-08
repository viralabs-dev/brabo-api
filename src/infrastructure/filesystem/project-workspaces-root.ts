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
 * o `permissions.json` é lido de `<raiz>/<projectId>/permissions.json`, e o
 * escopo de caminho do ADR 0055 autoriza comandos sob `<raiz>/<projectId>`.
 * Se as duas derivações divergissem, a política seria lida de um lugar e
 * aplicada a outro — falha silenciosa e difícil de enxergar.
 */
export function projectWorkspacesRoot(): string {
  return process.env.PROJECT_WORKSPACES_ROOT ?? '/tmp/brabo-project-workspaces';
}

/**
 * Um id de projeto é UUID vindo do banco. Aqui ele vira SEGMENTO DE CAMINHO, e
 * por isso a forma passou a ser exigida em vez de presumida — a checagem é
 * deliberadamente mais larga que UUID (aceita hex, hífen e sublinhado) para não
 * amarrar o formato do id, e estreita o bastante para que o resultado nunca
 * escape da raiz.
 */
const ID_DE_PROJETO_VALIDO = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * A pasta do projeto — o que o ADR 0055 chama de escopo.
 *
 * O `projectId` chega de `@Param('projectId')` sem pipe de validação, e o
 * Express decodifica o percent-encoding do segmento ANTES de entregá-lo: um
 * `projectId` como `..%2F..%2Fetc` vira `../../etc`, e o `join` o resolveria
 * para FORA da raiz sem reclamar. Isso valia para os dois consumidores desta
 * função, e o segundo é o que dói:
 *
 * - o `permissions.json` seria lido e ESCRITO em caminho arbitrário
 *   (`fs-permissions-file-store.ts`);
 * - o escopo de caminho do ADR 0055 (`propose-action.use-case.ts` →
 *   `decide.ts`) autoriza comando de terminal sob esta pasta. Um escopo que
 *   escapa da raiz é a política de aprovação apontando para o lugar errado —
 *   falha de SEGURANÇA, não de arquivo não encontrado.
 *
 * Validar aqui, e não em cada chamador, é a mesma razão que fez esta função
 * existir: as duas derivações têm que concordar, e uma checagem duplicada é
 * uma checagem que um dia diverge.
 */
export function projectScopeRoot(projectId: string): string {
  if (!ID_DE_PROJETO_VALIDO.test(projectId)) {
    throw new Error(
      `projectId inválido como segmento de caminho: ${JSON.stringify(projectId)}`,
    );
  }
  return join(projectWorkspacesRoot(), projectId);
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
  projectId: string,
  caminho: string | undefined,
): string {
  const bruto = caminho ?? '';
  // Byte NUL trunca o caminho em qualquer API que atravesse C, e nenhuma
  // normalização de string o enxerga — por isso a recusa vem antes dela.
  if (bruto.includes('\0')) throw new CaminhoForaDoEscopoError(bruto);

  const raiz = projectScopeRoot(projectId);
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
