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

/** AT-612 (ADR 0229, RN-936): um serviço de infra da instância de QA, declarado pela Infra. */
export interface ServicoDeQa {
  name: string;
  image: string;
  env?: Record<string, string>;
  tmpfs?: string[];
  shared?: boolean;
}

export interface QaDeExecucao {
  services: ServicoDeQa[];
}

export const MAXIMO_DE_SERVICOS_DE_QA = 6;
const NOME_DE_SERVICO = /^[a-z][a-z0-9-]{0,31}$/;
const IMAGEM_COM_DIGEST = /^[^\s@]+@sha256:[0-9a-f]{64}$/;
const NOME_DE_ENV = /^[A-Z_][A-Z0-9_]*$/;

export interface Run {
  command: string;
  urls: UrlDeExecucao[];
  envExample: boolean;
  /** Opcional: sem ele, `run` é byte a byte o de antes. */
  app?: AppDeExecucao;
  /** AT-612: serviços da instância de QA. Ausente = sem infra extra. */
  qa?: QaDeExecucao;
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
  if (r.qa !== undefined && r.qa !== null) {
    const recusa = recusaDoQa(r.qa);
    if (recusa) return recusa;
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

/** `null` quando `run.qa` é válido (AT-612). Mesma régua na proposta e na execução. */
export function recusaDoQa(qa: unknown): string | null {
  if (typeof qa !== 'object' || qa === null || Array.isArray(qa)) {
    return '`run.qa` deve ser um objeto `{services}`.';
  }
  const services = (qa as Record<string, unknown>).services;
  if (!Array.isArray(services) || services.length > MAXIMO_DE_SERVICOS_DE_QA) {
    return `\`run.qa.services\` deve ser uma lista de até ${MAXIMO_DE_SERVICOS_DE_QA} serviços.`;
  }
  const nomes = new Set<string>();
  for (const [i, item] of services.entries()) {
    const ref = `run.qa.services[${i}]`;
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      return `\`${ref}\` deve ser \`{name, image, env?, tmpfs?, shared?}\`.`;
    }
    const s = item as Record<string, unknown>;
    if (typeof s.name !== 'string' || !NOME_DE_SERVICO.test(s.name)) {
      return `\`${ref}.name\` deve casar [a-z][a-z0-9-]{0,31}.`;
    }
    if (nomes.has(s.name)) return `\`${ref}.name\` repetido: "${s.name}".`;
    nomes.add(s.name);
    if (typeof s.image !== 'string' || !IMAGEM_COM_DIGEST.test(s.image)) {
      return `\`${ref}.image\` deve trazer digest (@sha256:<64 hex>).`;
    }
    if (s.env !== undefined) {
      if (typeof s.env !== 'object' || s.env === null || Array.isArray(s.env)) {
        return `\`${ref}.env\` deve ser um objeto nome → texto.`;
      }
      const pares = Object.entries(s.env as Record<string, unknown>);
      if (pares.length > 20) return `\`${ref}.env\` passa de 20 variáveis.`;
      for (const [k, v] of pares) {
        if (!NOME_DE_ENV.test(k)) {
          return `\`${ref}.env\` tem nome inválido: "${k}".`;
        }
        if (typeof v !== 'string' || /[\n\r\0]/.test(v)) {
          return `\`${ref}.env.${k}\` deve ser texto de uma linha.`;
        }
      }
    }
    if (s.tmpfs !== undefined) {
      if (
        !Array.isArray(s.tmpfs) ||
        s.tmpfs.length > 3 ||
        s.tmpfs.some(
          (t) =>
            typeof t !== 'string' || !t.startsWith('/') || /[\s,:]/.test(t),
        )
      ) {
        return `\`${ref}.tmpfs\` deve ter até 3 caminhos absolutos.`;
      }
    }
    if (s.shared !== undefined && typeof s.shared !== 'boolean') {
      return `\`${ref}.shared\` deve ser booleano.`;
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
    ...(r.qa
      ? {
          qa: {
            services: r.qa.services.map(
              ({ name, image, env, tmpfs, shared }) => ({
                name,
                image,
                ...(env ? { env } : {}),
                ...(tmpfs ? { tmpfs } : {}),
                ...(shared !== undefined ? { shared } : {}),
              }),
            ),
          },
        }
      : {}),
  };
}
