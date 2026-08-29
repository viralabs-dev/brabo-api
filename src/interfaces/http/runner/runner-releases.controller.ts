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
import { Readable } from 'node:stream';
import { Public } from '../auth/public.decorator';

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
}

/** 5 minutos — só o suficiente pra absorver rajada de downloads concorrentes sem bater no rate limit não-autenticado do GitHub (60 req/hora por IP). */
const CACHE_TTL_MS = 5 * 60 * 1000;

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
      `${PLATAFORMAS.join(', ')}. Sem autenticação: o binário não é segredo.`,
  })
  @ApiResponse({
    status: 200,
    description:
      'O binário do runner, em stream. Não é JSON: `Content-Type: application/octet-stream`.',
    content: {
      'application/octet-stream': {
        schema: { type: 'string', format: 'binary' },
      },
    },
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

    const urlPorAsset = await this.obterUrlsDosAssets();
    const assetUrl = urlPorAsset.get(nomeDoAsset(platform));
    if (!assetUrl) {
      throw new BadGatewayException(
        `Plataforma "${platform}" ainda não publicada nesta release.`,
      );
    }

    let assetResp: globalThis.Response;
    try {
      assetResp = await fetch(assetUrl, {
        headers: { 'User-Agent': 'brabo-api' },
      });
    } catch {
      throw new BadGatewayException(
        'Não foi possível baixar o binário do GitHub Releases.',
      );
    }
    if (!assetResp.ok || !assetResp.body) {
      throw new BadGatewayException(
        'Não foi possível baixar o binário do GitHub Releases.',
      );
    }

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${nomeDoArquivoBaixado(platform)}"`,
    );
    Readable.fromWeb(
      assetResp.body as unknown as import('node:stream/web').ReadableStream,
    ).pipe(res);
  }

  /**
   * Cacheia a URL de download dos assets (nunca os bytes) por
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
