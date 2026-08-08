import { join } from 'node:path';

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
