import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { Observable } from 'rxjs';
import { finalize } from 'rxjs/operators';
import { rotaIgnorada } from './ignored-routes';
import {
  currentRequestContext,
  formatPath,
  runWithRequestContext,
  type RequestContext,
} from './request-context';

/**
 * Semeia o contexto de caminho e emite UMA linha por requisição (ADR 0035).
 *
 * ## Por que a fronteira HTTP não precisa de `@Traced`
 *
 * `getClass().name` e `getHandler().name` dão `SessionsController` e `create` sem
 * tocar nenhum dos ~30 controllers. Isso não é só conveniência: decorar
 * controller descartaria metadata do Nest (ver `traced.decorator.ts`) e acionaria
 * duas regras `severity: block` do docmap. A opção sem diff é também a segura.
 *
 * ## A forma do `Observable` não é estilo
 *
 * `runWithRequestContext(() => next.handle().pipe(...))` funciona no Nest 11 —
 * mas por detalhe de implementação: `next.handle()` é
 * `defer(AsyncResource.bind(...))`, e o `bind` fotografa o contexto assíncrono no
 * momento em que `handle()` é CHAMADO. Um `Observable` é frio: se a fotografia
 * passasse a acontecer na inscrição, a inscrição estaria fora do escopo do ALS e
 * o caminho sairia vazio, sem erro nenhum.
 *
 * Envolver a inscrição inteira é correto sob as duas semânticas e custa uma
 * linha. O teste "a store está visível dentro do handler" é o detector se o Nest
 * mudar isso de novo.
 */
@Injectable()
export class TracePathInterceptor implements NestInterceptor {
  constructor(
    @InjectPinoLogger(TracePathInterceptor.name)
    private readonly logger: PinoLogger,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    // Nada além de HTTP hoje, mas um contexto de microserviço ou de WebSocket não
    // tem `getRequest()` e quebraria aqui.
    if (context.getType() !== 'http') return next.handle();

    const req = context
      .switchToHttp()
      .getRequest<{ url?: string; method?: string }>();
    if (rotaIgnorada(req?.url)) return next.handle();

    return new Observable((subscriber) =>
      runWithRequestContext(() => {
        const ctx = currentRequestContext();
        if (!ctx) return next.handle().subscribe(subscriber);

        // A fronteira entra como primeiro passo, de graça.
        ctx.path.push({
          layer: 'interfaces',
          class: context.getClass().name,
          fn: context.getHandler().name,
          ms: 0,
          depth: 0,
        });
        ctx.depth = 1;

        return next
          .handle()
          .pipe(
            // `finalize` e não `tap({ complete })`: dispara em complete, erro E
            // cancelamento. Para um handler `@Sse` (o stream de chat é um) isso
            // significa que a linha sai no fechamento do stream — o mesmo momento
            // da linha `res` do pino-http. Consistente de propósito; não mova
            // para antes achando que é atraso.
            finalize(() => this.emitir(ctx, req)),
          )
          .subscribe(subscriber);
      }),
    );
  }

  private emitir(
    ctx: RequestContext,
    req: { url?: string; method?: string },
  ): void {
    try {
      const duracao =
        Math.round((performance.now() - ctx.startedAt) * 100) / 100;
      const isProd = process.env.NODE_ENV === 'production';

      this.logger.info(
        {
          path: formatPath(ctx),
          duration_ms: duracao,
          layer_count: ctx.path.length,
          method: req?.method,
          url: req?.url,
          // O array só em dev: o renderizador do pino-pretty desenha a árvore a
          // partir dele. Em produção `path` como string já basta, e o array
          // custaria 5-10x em bytes ingeridos no Loki, por requisição.
          ...(isProd ? {} : { layers: ctx.path }),
        },
        'caminho da requisição',
      );
    } catch {
      // Uma linha de log perdida não pode derrubar a resposta que já foi
      // produzida.
    }
  }
}
