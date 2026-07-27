import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { sql } from 'drizzle-orm';
import type { Response } from 'express';
import { IS_PUBLIC_KEY } from '../auth/public.decorator';
import type { AuthenticatedRequest } from '../auth/authenticated-request';
import { DRIZZLE } from '../../../infrastructure/persistence/drizzle/drizzle-client';
import type { DrizzleDb } from '../../../infrastructure/persistence/drizzle/drizzle-client';

/**
 * Rate limit por janela deslizante, com a janela no Postgres (Fase 5, item 7).
 *
 * ## Por que no Postgres
 *
 * O CLAUDE.md proíbe Redis — as filas ficam no Postgres via Oban, e trazer um
 * segundo armazenamento só para contar requisição contradiz essa decisão. O
 * custo é um INSERT por request contado, assumido e registrado no ADR 0027,
 * com `RATE_LIMIT_ENABLED=false` para desligar.
 *
 * ## Janela deslizante, não balde fixo
 *
 * Balde por minuto de relógio permite o dobro do limite na virada (tudo no
 * segundo 59, tudo de novo no 00). A janela deslizante conta os últimos N
 * milissegundos a partir de agora, então o limite vale em qualquer recorte.
 *
 * ## Dois baldes por request
 *
 * `user:<id>` e `ip:<endereço>`. O de usuário é o controle real; o de IP pega
 * o que ainda não autenticou e o caso de muitas contas atrás do mesmo cliente.
 * Estourar QUALQUER um dos dois barra — o mais restritivo vence.
 *
 * ## Quem não passa por aqui
 *
 * - rotas `@Public()`: probe e scrape do Prometheus. Estrangular o `/health`
 *   faz o kubelet reiniciar o pod, transformando pico de tráfego em queda;
 * - o client `engine-service`: o engine chama a api a cada evento de agente, em
 *   volume que não tem relação com abuso. Limitá-lo seria o sistema se
 *   auto-estrangulando sob carga normal.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);

  private readonly enabled = process.env.RATE_LIMIT_ENABLED !== 'false';
  private readonly windowMs = Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000);
  private readonly userLimit = Number(process.env.RATE_LIMIT_USER ?? 300);
  private readonly ipLimit = Number(process.env.RATE_LIMIT_IP ?? 600);
  private readonly engineClientId =
    process.env.ENGINE_KEYCLOAK_CLIENT_ID ?? 'engine-service';

  constructor(
    private readonly reflector: Reflector,
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.enabled) return true;
    if (context.getType() !== 'http') return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (request.clientId === this.engineClientId) return true;

    const baldes: { chave: string; limite: number }[] = [];
    if (request.user?.id) {
      baldes.push({ chave: `user:${request.user.id}`, limite: this.userLimit });
    }
    const ip = this.clientIp(request);
    if (ip) baldes.push({ chave: `ip:${ip}`, limite: this.ipLimit });
    if (baldes.length === 0) return true;

    let restanteMin = Number.POSITIVE_INFINITY;

    for (const balde of baldes) {
      let usados: number;
      try {
        usados = await this.registrarEContar(balde.chave);
      } catch (error) {
        // Falha do rate limit NÃO derruba a requisição: preferimos servir
        // demais a negar por um problema nosso. É a escolha certa aqui porque
        // este guard protege contra abuso, não contra acesso indevido — quem
        // faz autorização é o JwtAuthGuard, que já rodou.
        this.logger.warn(
          `rate limit indisponível (${(error as Error).message}) — liberando a requisição`,
        );
        return true;
      }

      restanteMin = Math.min(restanteMin, Math.max(0, balde.limite - usados));

      if (usados > balde.limite) {
        this.aplicarCabecalhos(context, balde.limite, 0);
        throw new HttpException(
          {
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            message: 'Limite de requisições excedido. Tente novamente em instantes.',
            error: 'Too Many Requests',
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    this.aplicarCabecalhos(context, this.userLimit, restanteMin);
    return true;
  }

  /**
   * Registra o hit e devolve quantos existem na janela — numa ida só ao banco.
   *
   * O INSERT e a contagem vão no mesmo statement por CTE: em duas consultas
   * separadas, duas requisições concorrentes leem a contagem antes de a outra
   * inserir e as duas passam. O CTE também economiza um round-trip, que num
   * caminho que roda a cada request não é detalhe.
   *
   * ## A soma explícita não é redundância
   *
   * Em Postgres, a linha inserida por uma CTE de escrita **não é visível** para
   * o resto do mesmo statement: o SELECT enxerga o snapshot de antes. Contar só
   * `rate_limit_hits` devolveria os hits ANTERIORES a este, e o limite passaria
   * a valer um a mais do que o configurado — um erro que só aparece exatamente
   * na borda, que é o único lugar onde este código importa. Daí somar
   * `(select count(*) from novo)`, que é o hit recém-inserido.
   */
  private async registrarEContar(chave: string): Promise<number> {
    const janelaSegundos = Math.max(1, Math.ceil(this.windowMs / 1000));

    const resultado = await this.db.execute<{ total: number }>(sql`
      with novo as (
        insert into rate_limit_hits (bucket_key) values (${chave})
        returning 1 as inserido
      )
      select (
               select count(*)
                 from rate_limit_hits
                where bucket_key = ${chave}
                  and occurred_at > now() - make_interval(secs => ${janelaSegundos})
             )::int
             + (select count(*) from novo)::int as total
    `);

    const linhas = (resultado as unknown as { rows?: { total: number }[] }).rows;
    return Number(linhas?.[0]?.total ?? 0);
  }

  /**
   * `X-RateLimit-*` para o cliente saber onde está antes de levar 429. Sem
   * eles, o consumidor só descobre o limite batendo nele.
   */
  private aplicarCabecalhos(
    context: ExecutionContext,
    limite: number,
    restante: number,
  ): void {
    const response = context.switchToHttp().getResponse<Response>();
    if (typeof response?.setHeader !== 'function') return;
    response.setHeader('X-RateLimit-Limit', String(limite));
    response.setHeader(
      'X-RateLimit-Remaining',
      String(Number.isFinite(restante) ? restante : limite),
    );
    response.setHeader(
      'X-RateLimit-Reset',
      String(Math.ceil((Date.now() + this.windowMs) / 1000)),
    );
  }

  /**
   * IP do cliente. `request.ip` do Express só é confiável com `trust proxy`
   * configurado; atrás do Ingress, sem isso, TODA requisição viria com o IP do
   * proxy e o balde de IP viraria um balde global — que estrangularia todo
   * mundo junto. Por isso o `X-Forwarded-For` é lido explicitamente, e o
   * primeiro endereço da lista é o cliente original.
   */
  private clientIp(request: AuthenticatedRequest): string | null {
    const encaminhado = request.headers['x-forwarded-for'];
    const bruto = Array.isArray(encaminhado) ? encaminhado[0] : encaminhado;
    if (bruto) {
      const primeiro = bruto.split(',')[0]?.trim();
      if (primeiro) return primeiro;
    }
    return request.ip ?? request.socket?.remoteAddress ?? null;
  }
}
