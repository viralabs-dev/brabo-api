import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { defer, of, throwError, Subject } from 'rxjs';
import { TracePathInterceptor } from '../../../src/infrastructure/observability/trace-path.interceptor';
import { currentRequestContext } from '../../../src/infrastructure/observability/request-context';

/**
 * O interceptor que semeia o caminho e emite a linha (ADR 0035).
 *
 * A regressão principal aqui é sutil e silenciosa. `next.handle()` devolve um
 * Observable FRIO: escrever
 *
 * ```ts
 * return runWithRequestContext(() => next.handle().pipe(finalize(...)))
 * ```
 *
 * funciona no Nest 11 apenas porque `handle()` é `defer(AsyncResource.bind(...))`
 * e o `bind` fotografa o contexto assíncrono na CHAMADA. Se essa fotografia
 * passasse a acontecer na inscrição — que é o que "frio" normalmente implica — a
 * inscrição estaria fora do escopo do `AsyncLocalStorage`, `pushStep` viraria
 * no-op e o caminho sairia sempre vazio. Sem erro, sem aviso: só um campo `path`
 * com um passo só, para sempre.
 *
 * Daí o teste "a store está visível DENTRO do handler", com um `defer` que lê o
 * contexto no momento da inscrição. É ele que detecta se o Nest mudar isso.
 */
function contexto(over: {
  tipo?: string;
  url?: string;
  method?: string;
  classe?: string;
  handler?: string;
}): ExecutionContext {
  const {
    tipo = 'http',
    url = '/projects/p1/sessions',
    method = 'POST',
  } = over;

  function SessionsController() {}
  function create() {}

  return {
    getType: () => tipo,
    getClass: () => ({ name: over.classe ?? SessionsController.name }),
    getHandler: () => ({ name: over.handler ?? create.name }),
    switchToHttp: () => ({ getRequest: () => ({ url, method }) }),
  } as unknown as ExecutionContext;
}

function logger() {
  return { info: vi.fn() };
}

describe('TracePathInterceptor', () => {
  let log: ReturnType<typeof logger>;
  let interceptor: TracePathInterceptor;

  beforeEach(() => {
    log = logger();
    interceptor = new TracePathInterceptor(log as never);
  });

  it('a store do ALS está visível DENTRO do handler', async () => {
    // O teste que fixa a forma `new Observable(...)`. Ver o cabeçalho.
    let visto: unknown;
    const handler: CallHandler = {
      handle: () =>
        defer(() => {
          visto = currentRequestContext();
          return of('ok');
        }),
    };

    await new Promise<void>((resolve) => {
      interceptor
        .intercept(contexto({}), handler)
        .subscribe({ complete: () => resolve() });
    });

    expect(visto).toBeDefined();
  });

  it('semeia a fronteira HTTP a partir do ExecutionContext', async () => {
    const handler: CallHandler = { handle: () => of('ok') };

    await new Promise<void>((resolve) => {
      interceptor
        .intercept(contexto({}), handler)
        .subscribe({ complete: () => resolve() });
    });

    // É esta linha que torna desnecessário decorar os ~30 controllers — e que
    // evita as duas regras `block` do docmap e o risco de perder metadata.
    const [campos] = log.info.mock.calls[0] as [Record<string, unknown>];
    expect(campos.path).toContain('interfaces/SessionsController.create');
    expect(campos.layer_count).toBe(1);
  });

  it('emite exatamente UMA linha no sucesso, com duração e rota', async () => {
    const handler: CallHandler = { handle: () => of('ok') };

    await new Promise<void>((resolve) => {
      interceptor
        .intercept(contexto({}), handler)
        .subscribe({ complete: () => resolve() });
    });

    expect(log.info).toHaveBeenCalledTimes(1);
    const [campos, mensagem] = log.info.mock.calls[0] as [
      Record<string, unknown>,
      string,
    ];
    expect(mensagem).toBe('caminho da requisição');
    expect(typeof campos.duration_ms).toBe('number');
    expect(campos.method).toBe('POST');
    expect(campos.url).toBe('/projects/p1/sessions');
  });

  it('preserva o valor emitido pelo handler', async () => {
    const handler: CallHandler = { handle: () => of({ id: 'sessao-1' }) };

    const valor = await new Promise((resolve) => {
      interceptor
        .intercept(contexto({}), handler)
        .subscribe({ next: (v) => resolve(v) });
    });

    // Instrumentar não pode alterar a resposta.
    expect(valor).toEqual({ id: 'sessao-1' });
  });

  it('emite a linha no erro e re-lança o erro', async () => {
    const falha = new Error('explodiu');
    const handler: CallHandler = { handle: () => throwError(() => falha) };

    const capturado = await new Promise((resolve) => {
      interceptor
        .intercept(contexto({}), handler)
        .subscribe({ error: (e) => resolve(e) });
    });

    expect(capturado).toBe(falha);
    expect(log.info).toHaveBeenCalledTimes(1);
  });

  it('emite no cancelamento — o caso do SSE que o cliente fecha', () => {
    // `finalize` cobre complete, error E unsubscribe. Com `tap({complete})` o
    // stream de chat fechado pelo browser não deixaria linha nenhuma.
    const aberto = new Subject<string>();
    const handler: CallHandler = { handle: () => aberto.asObservable() };

    const sub = interceptor.intercept(contexto({}), handler).subscribe();
    expect(log.info).not.toHaveBeenCalled();
    sub.unsubscribe();

    expect(log.info).toHaveBeenCalledTimes(1);
  });

  describe('passa direto, sem linha', () => {
    it('quando o contexto não é http', async () => {
      const handler: CallHandler = { handle: () => of('ok') };

      await new Promise<void>((resolve) => {
        interceptor
          .intercept(contexto({ tipo: 'rpc' }), handler)
          .subscribe({ complete: () => resolve() });
      });

      expect(log.info).not.toHaveBeenCalled();
    });

    it.each(['/live', '/health', '/metrics'])(
      'na rota de infraestrutura %s',
      (url) => {
        // As probes e o scrape batem a cada poucos segundos, para sempre.
        const handler: CallHandler = { handle: () => of('ok') };

        let completou = false;
        interceptor
          .intercept(contexto({ url }), handler)
          .subscribe({ complete: () => (completou = true) });

        // `of` é sincrono, então não há o que esperar.
        expect(completou).toBe(true);
        expect(log.info).not.toHaveBeenCalled();
      },
    );
  });
});
