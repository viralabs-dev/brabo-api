/**
 * RN-1522: fixa o digest das imagens de serviço da PR de infra consultando o
 * registro OCI v2 PÚBLICO (token anônimo). Só o nome público da imagem sai
 * daqui; nenhuma credencial, nenhum dado do usuário, nada vai a log.
 */
const TEMPO_MAXIMO_MS = 10_000;
const DIGEST = /@sha256:[0-9a-f]{64}$/;
const ACEITA = [
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.v2+json',
].join(', ');

export class DigestNaoResolvidoError extends Error {}

export type Busca = typeof fetch;

function partes(imagem: string): { host: string; repo: string; tag: string } {
  const barra = imagem.indexOf('/');
  const primeiro = barra === -1 ? '' : imagem.slice(0, barra);
  const comHost =
    primeiro.includes('.') ||
    primeiro.includes(':') ||
    primeiro === 'localhost';
  const host = comHost ? primeiro : 'docker.io';
  let resto = comHost ? imagem.slice(barra + 1) : imagem;
  const dois = resto.lastIndexOf(':');
  const tag = dois > resto.lastIndexOf('/') ? resto.slice(dois + 1) : '';
  if (tag) resto = resto.slice(0, dois);
  const repo =
    host === 'docker.io' && !resto.includes('/') ? `library/${resto}` : resto;
  return { host, repo, tag };
}

async function digestDe(imagem: string, busca: Busca): Promise<string> {
  const { host, repo, tag } = partes(imagem);
  if (!tag || tag === 'latest') {
    throw new DigestNaoResolvidoError(
      `A imagem "${imagem}" não tem uma versão fixa. Escreva a imagem com a versão do compose (ex.: postgres:16).`,
    );
  }
  const base = `https://${host === 'docker.io' ? 'registry-1.docker.io' : host}`;
  const url = `${base}/v2/${repo}/manifests/${tag}`;
  const chamar = (auth?: string) =>
    busca(url, {
      method: 'HEAD',
      headers: { Accept: ACEITA, ...(auth ? { Authorization: auth } : {}) },
      signal: AbortSignal.timeout(TEMPO_MAXIMO_MS),
    });
  let resposta = await chamar();
  if (resposta.status === 401) {
    const desafio = resposta.headers.get('www-authenticate') ?? '';
    const realm = /realm="([^"]+)"/.exec(desafio)?.[1];
    const servico = /service="([^"]+)"/.exec(desafio)?.[1];
    if (!realm || !realm.startsWith('https://')) {
      throw new DigestNaoResolvidoError('registro sem acesso anônimo');
    }
    const token = new URL(realm);
    if (servico) token.searchParams.set('service', servico);
    token.searchParams.set('scope', `repository:${repo}:pull`);
    const t = await busca(token, {
      signal: AbortSignal.timeout(TEMPO_MAXIMO_MS),
    });
    const corpo = (await t.json()) as { token?: string; access_token?: string };
    const jwt = corpo.token ?? corpo.access_token;
    if (!t.ok || !jwt)
      throw new DigestNaoResolvidoError('token anônimo negado');
    resposta = await chamar(`Bearer ${jwt}`);
  }
  const digest = resposta.headers.get('docker-content-digest') ?? '';
  if (!resposta.ok || !/^sha256:[0-9a-f]{64}$/.test(digest)) {
    throw new DigestNaoResolvidoError(`registro respondeu ${resposta.status}`);
  }
  return `${imagem}@${digest}`;
}

/**
 * Devolve uma cópia de `run` com `qa.services[].image` fixada em digest.
 * Falha vira `DigestNaoResolvidoError` com texto para quem não é técnico.
 */
export async function fixarDigestDasImagens(
  run: unknown,
  busca: Busca = fetch,
): Promise<unknown> {
  const services = (run as { qa?: { services?: unknown } } | null)?.qa
    ?.services;
  if (!Array.isArray(services)) return run;
  const fixados = await Promise.all(
    services.map(async (s: unknown) => {
      const imagem = (s as { image?: unknown } | null)?.image;
      if (typeof imagem !== 'string' || DIGEST.test(imagem)) return s;
      try {
        return { ...(s as object), image: await digestDe(imagem, busca) };
      } catch (erro) {
        if (
          erro instanceof DigestNaoResolvidoError &&
          erro.message.startsWith('A imagem')
        ) {
          throw erro;
        }
        throw new DigestNaoResolvidoError(
          `Não consegui confirmar agora a versão exata da imagem "${imagem}". Isso costuma ser um problema passageiro de rede: tente de novo em instantes.`,
        );
      }
    }),
  );
  return {
    ...(run as object),
    qa: { ...(run as { qa: object }).qa, services: fixados },
  };
}
