/**
 * Como rodar o entregável na máquina do usuário (AT-517, RN-852, ADR 0213).
 *
 * A Infra declara, no payload de `open_infra_pr`, o campo OBRIGATÓRIO `run`:
 * o comando (pelo compose da PR dela) e as URLs que ele abre. A api o valida
 * NA PROPOSTA e de novo NA EXECUÇÃO, com a MESMA régua do engine, e, com a PR
 * aberta, emite `artifact.run_instructions` — versionado, sem tabela, o
 * vigente é o de maior `version` (o desenho de `artifact.project_image`).
 *
 * Tudo aqui é PURO. O que a tela mostra é DECLARADO pela Infra e nunca
 * verificado na máquina de quem lê (RN-468).
 */

export const EVENTO_INSTRUCOES_DE_EXECUCAO = 'artifact.run_instructions';

export const TETO_DO_COMANDO = 300;
export const TETO_DO_ROTULO = 60;
export const MAXIMO_DE_URLS = 5;
export const TIPOS_DE_URL = ['api_docs', 'web'] as const;
const PREFIXOS_PERMITIDOS = ['http://localhost:', 'http://127.0.0.1:'];

export type TipoDeUrl = (typeof TIPOS_DE_URL)[number];

export interface UrlDeExecucao {
  label: string;
  url: string;
  kind: TipoDeUrl;
}

/** AT-610 (ADR 0228, RN-933): o comando que o container executa para subir o APP e a porta onde ele escuta. */
export interface AppDeExecucao {
  command: string;
  port: number;
}

export interface Run {
  command: string;
  urls: UrlDeExecucao[];
  envExample: boolean;
  /** Opcional: sem ele, `run` é byte a byte o de antes. */
  app?: AppDeExecucao;
}

export interface InstrucoesDeExecucao extends Run {
  prUrl: string;
}

/**
 * Devolve o MOTIVO da recusa (texto que chega ao modelo como resultado da
 * ferramenta) ou `null` quando `run` é válido.
 */
export function recusaDoRun(run: unknown): string | null {
  if (run === undefined || run === null) {
    return '`run` é obrigatório em `open_infra_pr`: `{command, urls, envExample}`.';
  }
  if (typeof run !== 'object' || Array.isArray(run)) {
    return '`run` deve ser um objeto `{command, urls, envExample}`.';
  }
  const r = run as Record<string, unknown>;
  if (typeof r.command !== 'string' || r.command.trim() === '') {
    return '`run.command` deve ser texto não vazio.';
  }
  if (r.command.length > TETO_DO_COMANDO) {
    return `\`run.command\` passa de ${TETO_DO_COMANDO} caracteres.`;
  }
  if (typeof r.envExample !== 'boolean') {
    return '`run.envExample` deve ser booleano.';
  }
  if (
    !Array.isArray(r.urls) ||
    r.urls.length < 1 ||
    r.urls.length > MAXIMO_DE_URLS
  ) {
    return `\`run.urls\` deve ter de 1 a ${MAXIMO_DE_URLS} itens.`;
  }
  if (r.app !== undefined && r.app !== null) {
    if (typeof r.app !== 'object' || Array.isArray(r.app)) {
      return '`run.app` deve ser um objeto `{command, port}`.';
    }
    const a = r.app as Record<string, unknown>;
    if (typeof a.command !== 'string' || a.command.trim() === '') {
      return '`run.app.command` deve ser texto não vazio.';
    }
    // Code points, como o engine (graphemes): acento/emoji não divergem na fronteira.
    if ([...a.command].length > TETO_DO_COMANDO) {
      return `\`run.app.command\` passa de ${TETO_DO_COMANDO} caracteres.`;
    }
    if (/[\n\r\0]/.test(a.command)) {
      return '`run.app.command` deve ter uma linha só (sem quebra de linha nem NUL).';
    }
    if (
      typeof a.port !== 'number' ||
      !Number.isInteger(a.port) ||
      a.port < 1024 ||
      a.port > 65535
    ) {
      return '`run.app.port` deve ser inteiro de 1024 a 65535.';
    }
  }
  for (const [i, item] of (r.urls as unknown[]).entries()) {
    if (typeof item !== 'object' || item === null) {
      return `\`run.urls[${i}]\` deve ser \`{label, url, kind}\`.`;
    }
    const u = item as Record<string, unknown>;
    if (
      typeof u.label !== 'string' ||
      u.label.trim() === '' ||
      u.label.length > TETO_DO_ROTULO
    ) {
      return `\`run.urls[${i}].label\` deve ser texto de 1 a ${TETO_DO_ROTULO} caracteres.`;
    }
    if (
      typeof u.url !== 'string' ||
      !PREFIXOS_PERMITIDOS.some((p) => (u.url as string).startsWith(p))
    ) {
      return `\`run.urls[${i}].url\` deve começar com \`http://localhost:\` ou \`http://127.0.0.1:\`.`;
    }
    if (!TIPOS_DE_URL.includes(u.kind as TipoDeUrl)) {
      return `\`run.urls[${i}].kind\` deve ser \`api_docs\` ou \`web\`.`;
    }
    // RN-863 (AT-524): `api_docs` é a UI Swagger em `/docs`, nunca rota de
    // negócio — mesma régua de `Engine.Infra.InstrucoesDeExecucao.validar/1`.
    if (u.kind === 'api_docs' && !u.url.endsWith('/docs')) {
      return `\`run.urls[${i}].url\` de \`api_docs\` deve terminar em \`/docs\` (a UI Swagger), nunca uma rota de negócio.`;
    }
  }
  return null;
}

/** Só chame depois de `recusaDoRun(run) === null`. */
export function normalizarRun(run: unknown): Run {
  const r = run as Run;
  return {
    command: r.command,
    envExample: r.envExample,
    urls: r.urls.map(({ label, url, kind }) => ({ label, url, kind })),
    ...(r.app ? { app: { command: r.app.command, port: r.app.port } } : {}),
  };
}
