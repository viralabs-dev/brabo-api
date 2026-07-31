import { SpanStatusCode, trace } from '@opentelemetry/api';
import {
  currentRequestContext,
  pushStep,
  type TraceStep,
} from './request-context';

/**
 * `@Traced('<camada>')` — marca um método de fronteira no caminho da requisição
 * e abre uma span para ele (ADR 0035).
 *
 * Uma linha por método, e o log passa a mostrar por onde a ação do usuário andou:
 *
 * ```ts
 * @Traced('application')
 * async execute(projectId: string, userId: string) { … }
 * ```
 *
 * ## NUNCA use isto sob `src/interfaces/http/**`
 *
 * Regra dura, e o motivo é de segurança. Os decorators do Nest (`SetMetadata` e
 * tudo que deriva dele — `@Public`, `@RequireRole`, `@ApiOperation`) gravam
 * metadata **no objeto função** do método. Decorators legacy aplicam de baixo
 * para cima, então trocar `descriptor.value` DESCARTA a metadata escrita abaixo.
 * Num controller isso significa um `@RequireRole` que desaparece: compila, passa
 * na suite, e vira buraco de autorização.
 *
 * A fronteira HTTP já é coberta de graça pelo `TracePathInterceptor`, que lê
 * `ExecutionContext.getClass()` e `getHandler()` sem tocar arquivo de controller
 * nenhum. Não há nada a ganhar decorando controller — só risco.
 *
 * (Ainda assim, este decorator copia a metadata adiante. Cinto e suspensório: a
 * regra evita o problema, a cópia sobrevive a quem não a conhece.)
 *
 * ## Não decore nada que devolva `Observable`
 *
 * A regra 2 abaixo classificaria um `Observable` como síncrono e fecharia a span
 * antes de o stream produzir qualquer coisa. Handler `@Sse` e afins ficam com o
 * interceptor, que usa `finalize`.
 *
 * ## As cinco invariantes
 *
 * A filosofia é a de `trace-context.spec.ts`: **instrumentar não pode quebrar nem
 * alterar o que já funcionava.** Cada uma tem teste em `traced.spec.ts`:
 *
 * 1. `this` preservado — o wrapper é `function`, nunca arrow, e chama
 *    `original.apply(this, args)`. Uma arrow ligaria `this` ao protótipo e todo
 *    `this.repo` de todo caso de uso viraria `undefined`.
 * 2. Síncrono continua síncrono — só encadeia `.then` se o retorno for thenable.
 *    Transformar um método síncrono em Promise muda a semântica de quem chama,
 *    em silêncio.
 * 3. O erro é re-lançado IDÊNTICO — `throw error`, nunca embrulhado. Os dois
 *    exception filters globais despacham por classe do erro; embrulhar viraria
 *    um 409 de domínio em 500.
 * 4. A instrumentação nunca lança — todo o bookkeeping fica em `try/catch`
 *    engolido. O único que escapa é o erro do método.
 * 5. O valor de retorno é preservado por identidade.
 */
export type TracedLayer =
  'interfaces' | 'application' | 'domain' | 'infrastructure';

export interface TracedOptions {
  /**
   * Nome da span, quando o default `Classe.metodo` não serve — para manter nome
   * de domínio já existente no Tempo.
   */
  name?: string;

  /**
   * O método já abre e fecha a própria span: registre só o passo do caminho, sem
   * abrir outra.
   *
   * Existe por causa de `CreateSessionUseCase.execute`, que abre `session.create`
   * — a span que o ADR 0026 designa como **raiz da trace da sessão**, e cujo
   * `traceparent` é persistido em `sessions.trace_parent`. Envolvê-la faria da
   * span do decorator a raiz: o `trace_id` continuaria certo, mas
   * `docs/reference/events.md` afirma que a raiz é `session.create`, e a
   * afirmação passaria a ser falsa sem nada quebrar.
   */
  ownSpan?: boolean;
}

// Um tracer por módulo, não por chamada. `trace.getTracer` antes de o provider
// existir devolve um proxy que resolve na primeira chamada, então isto é seguro
// no topo do módulo.
const tracer = trace.getTracer('brabo-api');

function ehThenable(valor: unknown): valor is Promise<unknown> {
  return (
    typeof valor === 'object' &&
    valor !== null &&
    typeof (valor as { then?: unknown }).then === 'function'
  );
}

export function Traced(
  layer: TracedLayer,
  options?: TracedOptions,
): MethodDecorator {
  return (
    _target: object,
    propertyKey: string | symbol,
    descriptor: PropertyDescriptor,
  ): PropertyDescriptor => {
    const original = descriptor.value as (...args: unknown[]) => unknown;
    if (typeof original !== 'function') return descriptor;

    const nomeMetodo = String(propertyKey);

    // `function`, não arrow: a invariante 1 depende disto.
    descriptor.value = function (this: unknown, ...args: unknown[]): unknown {
      // O nome da classe sai da instância em tempo de chamada, não do `target`
      // do decorator: numa subclasse é o nome da subclasse que interessa. Toda a
      // leitura é defensiva — um decorator que levanta lendo um NOME seria o
      // pior modo de falha possível.
      let nomeClasse = 'desconhecida';
      try {
        nomeClasse =
          (this as { constructor?: { name?: string } })?.constructor?.name ??
          'desconhecida';
      } catch {
        /* mantém o default */
      }

      const nomeSpan = options?.name ?? `${nomeClasse}.${nomeMetodo}`;
      const inicio = performance.now();
      const ctx = currentRequestContext();
      const profundidade = ctx?.depth ?? 0;

      // Registrado na ENTRADA, para o caminho sair em ordem de chamada e não de
      // término (ver `pushStep`). `ms` é preenchido na saída, no objeto guardado.
      let passo: TraceStep | undefined;
      try {
        passo = pushStep({
          layer,
          class: nomeClasse,
          fn: nomeMetodo,
          ms: 0,
          depth: profundidade,
        });
        if (ctx) ctx.depth = profundidade + 1;
      } catch {
        /* invariante 4 */
      }

      const encerrar = (
        span: ReturnType<typeof tracer.startSpan>,
        erro?: unknown,
      ) => {
        try {
          if (erro !== undefined) {
            span.recordException(erro as Error);
            span.setStatus({ code: SpanStatusCode.ERROR });
          }
          span.end();
        } catch {
          /* invariante 4 */
        }
        try {
          if (ctx) ctx.depth = profundidade;
          if (passo) {
            // Duas casas: `Date.now()` faria todo repositório rápido ler 0ms, e
            // é justamente o passo rápido demais que se quer poder descartar.
            passo.ms = Math.round((performance.now() - inicio) * 100) / 100;
            if (erro !== undefined) {
              passo.error =
                (erro as { constructor?: { name?: string } })?.constructor
                  ?.name ?? 'Error';
            }
          }
        } catch {
          /* invariante 4 */
        }
      };

      // `startActiveSpan` e não `startSpan`: é o que torna a span ATIVA, então
      // span aninhada aninha de verdade no Tempo e o `mixin` do pino lê ESTE
      // trace nas linhas emitidas dentro do método. Sob o NoopTracer ele apenas
      // invoca o callback e devolve o retorno — o que mantém o decorator inócuo
      // em teste unitário sem provider registrado.
      //
      // Com `ownSpan`, o corpo é o mesmo mas sem abrir span: a mesma sequência de
      // encerramento roda sobre uma span de mentira que só descarta as chamadas.
      const executar = (span: ReturnType<typeof tracer.startSpan>): unknown => {
        try {
          span.setAttribute('brabo.layer', layer);
          span.setAttribute('code.namespace', nomeClasse);
          span.setAttribute('code.function', nomeMetodo);
        } catch {
          /* invariante 4 */
        }

        let resultado: unknown;
        try {
          resultado = original.apply(this, args);
        } catch (erro) {
          encerrar(span, erro);
          throw erro; // invariante 3
        }

        if (ehThenable(resultado)) {
          return resultado.then(
            (valor) => {
              encerrar(span);
              return valor; // invariante 5
            },
            (erro: unknown) => {
              encerrar(span, erro);
              throw erro; // invariante 3
            },
          );
        }

        encerrar(span);
        return resultado; // invariantes 2 e 5
      };

      if (options?.ownSpan) {
        // Span inerte: `encerrar` chama `recordException`/`setStatus`/`end` sem
        // condicional, e quem registra a span de verdade é o próprio método.
        return executar(
          trace.wrapSpanContext({
            traceId: '',
            spanId: '',
            traceFlags: 0,
          }),
        );
      }

      return tracer.startActiveSpan(nomeSpan, executar);
    };

    // Metadata do Nest sobrevive à troca de `descriptor.value`. A regra de
    // posicionamento acima já evita o caso perigoso; isto cobre quem não a leu.
    try {
      const substituto = descriptor.value as object;
      for (const chave of Reflect.getOwnMetadataKeys(original)) {
        const valor: unknown = Reflect.getOwnMetadata(chave, original);
        Reflect.defineMetadata(chave, valor, substituto);
      }
    } catch {
      /* invariante 4 */
    }

    // Sem isto o método passa a se chamar "" em stack trace e em qualquer coisa
    // que leia `fn.name`.
    try {
      Object.defineProperty(descriptor.value, 'name', {
        value: nomeMetodo,
        configurable: true,
      });
    } catch {
      /* invariante 4 */
    }

    return descriptor;
  };
}
