import {
  BadGatewayException,
  BadRequestException,
  Controller,
  Get,
  Query,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Public } from '../auth/public.decorator';
import {
  NOME_DO_MANIFESTO,
  parsearChecksums,
  type MotivoDaRecusa,
} from './checksums';

const GITHUB_RELEASES_URL =
  'https://api.github.com/repos/daneiel/brabo/releases/latest';

const PLATAFORMAS = [
  'linux-x64',
  'linux-arm64',
  'darwin-x64',
  'darwin-arm64',
  'win32-x64',
] as const;
type Plataforma = (typeof PLATAFORMAS)[number];

function ehPlataformaValida(valor: string): valor is Plataforma {
  return (PLATAFORMAS as readonly string[]).includes(valor);
}

function nomeDoAsset(plataforma: Plataforma): string {
  return plataforma === 'win32-x64'
    ? 'brabo-runner-win32-x64.exe'
    : `brabo-runner-${plataforma}`;
}

function nomeDoArquivoBaixado(plataforma: Plataforma): string {
  return plataforma === 'win32-x64' ? 'brabo-runner.exe' : 'brabo-runner';
}

interface CacheDeAssets {
  buscadoEm: number;
  urlPorAsset: Map<string, string>;
  /**
   * O manifesto JÁ LIDO desta mesma janela de cache, ou `undefined` enquanto
   * ninguém precisou dele. São centenas de bytes de TEXTO — o cache continua
   * não guardando byte de binário nenhum, que a 79 MB por asset seria a coisa
   * errada a guardar num processo com 512Mi de limite.
   *
   * Ele mora na MESMA entrada que as URLs, e não num cache próprio, porque as
   * duas coisas precisam vir da MESMA release: cachear a URL do binário por
   * cinco minutos e reler o manifesto a cada requisição deixaria a janela em
   * que uma release nova é publicada comparando o hash novo com o binário
   * velho, e o desfecho disso seria `hash_divergente` — uma recusa que
   * pareceria adulteração.
   */
  manifesto?: Map<string, string>;
}

/** 5 minutos — só o suficiente pra absorver rajada de downloads concorrentes sem bater no rate limit não-autenticado do GitHub (60 req/hora por IP). */
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Teto de bytes do download, medido contra o artefato real: os binários
 * publicados têm ~79 MB (v5.0.0). 256 MiB dá três vezes essa folga e ainda
 * recusa uma resposta absurda antes de ela encher o `/tmp` do pod — que é um
 * `emptyDir` sem `sizeLimit` (`deploy/k8s/base/api/deployment.yaml`), numa
 * rota `@Public()` que qualquer um chama.
 */
const TETO_DE_BYTES = 256 * 1024 * 1024;

/** Erro interno da verificação — vira 502 com `motivo` no `binary`. */
class RecusaError extends Error {
  constructor(
    readonly motivo: MotivoDaRecusa,
    mensagem: string,
  ) {
    super(mensagem);
  }
}

function recusar(motivo: MotivoDaRecusa, mensagem: string): never {
  throw new BadGatewayException({
    statusCode: 502,
    message: mensagem,
    motivo,
  });
}

/**
 * Proxy do binário standalone do `brabo-runner` publicado em GitHub Releases
 * (`bun build --compile`, ADR 0112) — o navegador não fala com o GitHub
 * diretamente porque a release é privada de implementação (o nome exato do
 * asset pode mudar) e porque isto abre espaço pra cachear a resolução do
 * asset sem expor a chamada crua ao cliente.
 *
 * `@Public()` — mesma razão do JWKS (`JwksController`): o binário não é
 * segredo, e exigir login pra baixar o instalador seria pedir credencial
 * antes de a pessoa ter onde guardar uma.
 *
 * `platform` é uma ALLOWLIST fechada, nunca interpolado cru no nome do
 * asset/URL — a única entrada vinda do cliente que participa da chamada ao
 * GitHub é o valor já validado contra `PLATAFORMAS`, fechando o vetor de
 * SSRF/path injection que um parâmetro livre abriria.
 *
 * Tag `infrastructure` — mesma categoria de `MetricsController`/
 * `JwksController`: rota fora do escopo de um projeto específico, tão de
 * infraestrutura quanto scrape/JWKS.
 *
 * ---
 *
 * ## A verificação (ADR 0149, RN-525)
 *
 * Até a FASE 29 esta rota validava a ENTRADA e transmitia os bytes do GitHub
 * direto para o cliente, sem verificar nada — o BRB-005 nomeia isso, e o
 * ADR 0149 a lista como um dos três consumidores da assinatura. Agora ela
 * confere o **sha256 dos bytes contra o `checksums.txt` da mesma Release**, e
 * **recusa** quando não pode conferir. Nenhum byte não conferido chega ao
 * cliente: a resposta só começa depois de o hash bater.
 *
 * ### O que esta verificação NÃO faz, e por quê
 *
 * Ela **não verifica a assinatura** do `checksums.txt`
 * (`checksums.txt.bundle`, `cosign sign-blob`). Isto é INTEGRIDADE contra o
 * manifesto, **não procedência**: quem consiga reescrever a Release reescreve
 * os dois arquivos e passa por aqui. A distinção está na mensagem, no
 * `Content-Digest` e na RN, e não é rodapé — é o limite do que esta rota
 * prova.
 *
 * As duas formas de fechar isso foram MEDIDAS, e as duas foram recusadas
 * nesta sessão:
 *
 * - **`cosign` na imagem da api:** 155 MB (`cosign-linux-amd64` v2.6.1),
 *   contra uma imagem de runtime que é Alpine + Node. Quase dobrar a imagem de
 *   produção — publicada por digest no GHCR (ADR 0119) — pra verificar um
 *   download opcional não se paga.
 * - **`@sigstore/verify` + `@sigstore/tuf`:** 2,5 MB e 12 pacotes, barato. O
 *   que custa não é o tamanho: `getTrustedRoot()` refresca metadados TUF
 *   contra `tuf-repo-cdn.sigstore.dev` (o `seeds.json` do pacote só semeia o
 *   `root.json`), então esta rota — `@Public()`, sem autenticação, e o ponto
 *   de entrada do onboarding do ADR 0118 — passaria a depender de um SEGUNDO
 *   host de terceiro além do GitHub. E, pela régua dos ADRs 0041/0042
 *   (capability só é declarada quando PROVADA), não há como provar o caminho
 *   ponta a ponta hoje: **nenhuma Release tem `checksums.txt.bundle`** — o job
 *   `checksums` nasceu na sessão 2 e só roda numa tag final, e a própria
 *   RN-524 já declara essa lacuna do lado de quem ASSINA. Embarcar uma
 *   verificação não provável na frente do onboarding trocaria uma fraqueza
 *   conhecida por um 502 em toda plataforma, em toda instalação, descoberto
 *   só em produção.
 *
 * O consumidor que verifica a ASSINATURA é o `install.sh` (ADR 0150,
 * sessão 4/7), que tem `cosign` de verdade e o baixa pinado com
 * `sha256sum -c` (decisão 4 do ADR 0149). **BRB-005 segue aberto para a
 * metade de procedência desta rota**, e o registro diz isso.
 *
 * ### O streaming, e por que passa pelo disco
 *
 * Conferir sha256 exige ler todos os bytes antes de responder. Bufferizar os
 * ~79 MB do binário em memória seria exaustão trivial numa rota pública — o
 * pod da api tem `limits.memory: 512Mi` —, e cachear os bytes seria pior
 * ainda (5 plataformas × 79 MB). Então os bytes descem em STREAM para um
 * arquivo temporário em `/tmp` (um `emptyDir` montado justamente porque o
 * rootfs é read-only), com o hash sendo calculado no caminho, e o arquivo é
 * relido em stream para o cliente **só depois** de o hash bater. Memória fica
 * constante; o custo é um arquivo transitório por download em voo, apagado no
 * `finally` inclusive quando a verificação recusa.
 */
@ApiTags('infrastructure')
@Controller('runner-releases')
export class RunnerReleasesController {
  private cache: CacheDeAssets | null = null;

  @Get('binary')
  @Public()
  @ApiOperation({
    summary: 'Baixa o binário standalone do runner local pra plataforma pedida',
    description:
      'Proxy de GitHub Releases — `platform` aceita só ' +
      `${PLATAFORMAS.join(', ')}. Sem autenticação: o binário não é segredo. ` +
      'Os bytes são conferidos contra o `checksums.txt` da mesma Release ' +
      'antes de qualquer coisa ser respondida (ADR 0149, RN-525); a rota ' +
      'NÃO verifica a assinatura do manifesto — isso é integridade, não ' +
      'procedência, e quem verifica assinatura é o `install.sh`.',
  })
  @ApiResponse({
    status: 200,
    description:
      'O binário do runner, em stream, com o sha256 já conferido contra o ' +
      'manifesto. Não é JSON: `Content-Type: application/octet-stream`. O ' +
      'header `Content-Digest` repete o hash conferido (RFC 9530).',
    content: {
      'application/octet-stream': {
        schema: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiResponse({
    status: 502,
    description:
      'Recusa nomeada — nunca bytes com aviso. O corpo traz `motivo`: ' +
      '`plataforma_nao_publicada`, `release_sem_manifesto`, ' +
      '`manifesto_nao_cobre_a_plataforma`, `manifesto_ilegivel`, ' +
      '`download_falhou` ou `hash_divergente`.',
  })
  async binary(
    @Query('platform') platform: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    if (!platform || !ehPlataformaValida(platform)) {
      throw new BadRequestException(
        `platform inválida — use uma de: ${PLATAFORMAS.join(', ')}`,
      );
    }

    const asset = nomeDoAsset(platform);
    const urlPorAsset = await this.obterUrlsDosAssets();
    const assetUrl = urlPorAsset.get(asset);
    if (!assetUrl) {
      recusar(
        'plataforma_nao_publicada',
        `Plataforma "${platform}" ainda não publicada nesta release.`,
      );
    }

    // A ausência do manifesto é RECUSA, não "sirvo avisando". Um aviso que se
    // aceita clicando é uma verificação que não existe (ADR 0149, decisão 3) —
    // e, pior, seria o downgrade mais barato que existe: apagar um arquivo de
    // 400 bytes da Release desligaria a conferência de todo mundo. O custo
    // está medido e é pequeno: o passo do binário é BEST-EFFORT no fluxo do
    // navegador (RN-473, passo 4) e cai em `npm install -g @brabo/runner`, que
    // não depende de release nenhuma.
    const manifesto = await this.obterManifesto(urlPorAsset);
    if (!manifesto) {
      recusar(
        'release_sem_manifesto',
        `Esta release não publica ${NOME_DO_MANIFESTO} — não há contra o que conferir o binário, ` +
          'e servir bytes não conferidos não é uma opção. Instale com `npm install -g @brabo/runner`.',
      );
    }

    const hashEsperado = manifesto.get(asset);
    if (!hashEsperado) {
      recusar(
        'manifesto_nao_cobre_a_plataforma',
        `O ${NOME_DO_MANIFESTO} desta release não cobre "${asset}" — sem a linha dele no manifesto ` +
          'não há hash contra o que conferir, e o binário não é servido.',
      );
    }

    const pasta = await mkdtemp(join(tmpdir(), 'brabo-runner-'));
    const caminho = join(pasta, nomeDoArquivoBaixado(platform));
    try {
      const hashObtido = await this.baixarConferindo(assetUrl, caminho);
      if (hashObtido !== hashEsperado) {
        recusar(
          'hash_divergente',
          `O binário de "${platform}" não bate com o ${NOME_DO_MANIFESTO} da release ` +
            `(esperado ${hashEsperado}, obtido ${hashObtido}). Nada foi servido.`,
        );
      }

      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${nomeDoArquivoBaixado(platform)}"`,
      );
      // RFC 9530. Diz o que foi conferido, e é o que permite a quem recebe
      // repetir a conta sem confiar na nossa palavra.
      res.setHeader(
        'Content-Digest',
        `sha-256=:${Buffer.from(hashObtido, 'hex').toString('base64')}:`,
      );
      // A partir daqui os headers já foram escritos, e nenhum erro pode virar
      // resposta de erro — quem cai aqui é cliente que desconectou no meio do
      // download de 79 MB, que é rotina e não incidente.
      await pipeline(createReadStream(caminho), res).catch(() => {
        res.destroy();
      });
    } catch (erro) {
      if (erro instanceof RecusaError) recusar(erro.motivo, erro.message);
      throw erro;
    } finally {
      // Best-effort: falhar em limpar `/tmp` não pode virar 500 depois de a
      // resposta já ter saído.
      await rm(pasta, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /**
   * Baixa `url` para `destino` em STREAM, calculando o sha256 no caminho, e
   * devolve o hash em hexadecimal. Nunca segura o arquivo inteiro em memória.
   */
  private async baixarConferindo(
    url: string,
    destino: string,
  ): Promise<string> {
    let resp: globalThis.Response;
    try {
      resp = await fetch(url, { headers: { 'User-Agent': 'brabo-api' } });
    } catch {
      throw new RecusaError(
        'download_falhou',
        'Não foi possível baixar o binário do GitHub Releases.',
      );
    }
    if (!resp.ok || !resp.body) {
      throw new RecusaError(
        'download_falhou',
        'Não foi possível baixar o binário do GitHub Releases.',
      );
    }

    const hash = createHash('sha256');
    let bytes = 0;
    try {
      await pipeline(
        Readable.fromWeb(
          resp.body as unknown as import('node:stream/web').ReadableStream,
        ),
        async function* (fonte: AsyncIterable<Uint8Array>) {
          for await (const pedaco of fonte) {
            bytes += pedaco.length;
            if (bytes > TETO_DE_BYTES) {
              throw new RecusaError(
                'download_falhou',
                `O binário passou do teto de ${TETO_DE_BYTES} bytes — download abortado.`,
              );
            }
            hash.update(pedaco);
            yield pedaco;
          }
        },
        createWriteStream(destino),
      );
    } catch (erro) {
      if (erro instanceof RecusaError) throw erro;
      throw new RecusaError(
        'download_falhou',
        'O download do binário foi interrompido antes do fim.',
      );
    }

    return hash.digest('hex');
  }

  /**
   * O `checksums.txt` da release corrente, já parseado — ou `null` quando a
   * release não publica manifesto nenhum (que é o caso de TODA release
   * anterior à primeira tag depois do ADR 0149).
   *
   * "Não publica" é decidido pela LISTAGEM dos assets, sem chamada de rede: o
   * manifesto só é baixado quando existe. Manifesto listado que falha ao
   * baixar é outro desfecho (`manifesto_ilegivel`) — confundir os dois faria a
   * tela mandar a pessoa instalar pelo npm por causa de uma falha de rede
   * momentânea.
   */
  private async obterManifesto(
    urlPorAsset: Map<string, string>,
  ): Promise<Map<string, string> | null> {
    if (this.cache?.manifesto) return this.cache.manifesto;

    const url = urlPorAsset.get(NOME_DO_MANIFESTO);
    if (!url) return null;

    let resp: globalThis.Response;
    try {
      resp = await fetch(url, { headers: { 'User-Agent': 'brabo-api' } });
    } catch {
      recusar(
        'manifesto_ilegivel',
        `Não foi possível baixar o ${NOME_DO_MANIFESTO} da release.`,
      );
    }
    if (!resp.ok) {
      recusar(
        'manifesto_ilegivel',
        `Não foi possível baixar o ${NOME_DO_MANIFESTO} da release.`,
      );
    }

    const manifesto = parsearChecksums(await resp.text());
    if (manifesto.size === 0) {
      recusar(
        'manifesto_ilegivel',
        `O ${NOME_DO_MANIFESTO} da release não tem nenhuma linha legível.`,
      );
    }

    // Memoiza só no SUCESSO, e na mesma entrada das URLs: um manifesto que
    // falhou não pode ficar cinco minutos grudado no cache derrubando a rota.
    if (this.cache) this.cache.manifesto = manifesto;
    return manifesto;
  }

  /**
   * Cacheia a URL de download dos assets (nunca os bytes do binário) por
   * `CACHE_TTL_MS` — um `Map` simples com timestamp de instância, sem
   * dependência externa. Só a RESOLUÇÃO do asset (uma chamada leve à API do
   * GitHub) é cara em termos de rate limit; o download em si (pro
   * `browser_download_url`, que não é a API REST) não conta nessa cota.
   */
  private async obterUrlsDosAssets(): Promise<Map<string, string>> {
    if (this.cache && Date.now() - this.cache.buscadoEm < CACHE_TTL_MS) {
      return this.cache.urlPorAsset;
    }

    let resp: globalThis.Response;
    try {
      resp = await fetch(GITHUB_RELEASES_URL, {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'brabo-api',
        },
      });
    } catch {
      throw new BadGatewayException(
        'Não foi possível consultar o GitHub Releases.',
      );
    }
    if (!resp.ok) {
      throw new BadGatewayException(
        'Não foi possível consultar o GitHub Releases.',
      );
    }

    const corpo = (await resp.json()) as {
      assets?: Array<{ name: string; browser_download_url: string }>;
    };
    const urlPorAsset = new Map<string, string>();
    for (const asset of corpo.assets ?? []) {
      urlPorAsset.set(asset.name, asset.browser_download_url);
    }

    this.cache = { buscadoEm: Date.now(), urlPorAsset };
    return urlPorAsset;
  }
}
