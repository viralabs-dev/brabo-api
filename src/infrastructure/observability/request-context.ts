import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * O caminho que uma requisição percorre entre as camadas (ADR 0035).
 *
 * Mesmo padrão do `drizzle-context.ts` ao lado — `AsyncLocalStorage` de módulo,
 * funções pequenas, sem classe e sem DI — porque é o mesmo problema: levar algo
 * implícito por toda a pilha de chamadas sem obrigar cada assinatura a carregá-lo.
 * Lá é a transação; aqui é a trilha de camadas.
 *
 * ## O que este módulo deliberadamente NÃO guarda
 *
 * **`trace_id`.** Ele já entra em toda linha pelo `mixin` do pino, lendo o
 * contexto do OTel. Guardar uma segunda cópia aqui criaria duas fontes para o
 * único campo que o ADR 0026 chama de contrato — e duas fontes divergem.
 *
 * **`requestId`.** O `genReqId` do pino-http não está configurado, então `req.id`
 * é um contador por processo que não significa nada entre pods. Um id novo aqui
 * seria uma segunda chave de correlação que nada consome. Correlaciona-se por
 * `trace_id`, e só.
 */

/** Um passo do caminho: quem foi chamado, em que camada, e quanto levou. */
export interface TraceStep {
  layer: string;
  class: string;
  fn: string;
  ms: number;
  /** Profundidade na pilha de chamadas decoradas, para desenhar a árvore. */
  depth: number;
  /** Nome da classe do erro, quando o passo falhou. */
  error?: string;
}

export interface RequestContext {
  readonly startedAt: number;
  /** Mutado no lugar por `pushStep`. */
  readonly path: TraceStep[];
  /** Profundidade corrente, mantida pelo decorator ao entrar e sair. */
  depth: number;
  /** `true` quando o teto de passos foi atingido e passos foram descartados. */
  truncated: boolean;
}

/**
 * Teto de passos por requisição.
 *
 * Sem isto, um caso de uso que chama repositório em laço (aprovar em lote,
 * reprocessar event log) cresce o array sem limite pela vida da requisição e
 * depois serializa tudo numa linha de log. É a forma mais provável de esta
 * feature causar incidente, então o limite vem antes de qualquer uso.
 */
const MAX_STEPS = 64;

const als = new AsyncLocalStorage<RequestContext>();

/** Roda `work` com um contexto novo. Quem semeia é o interceptor. */
export function runWithRequestContext<T>(work: () => T): T {
  const ctx: RequestContext = {
    startedAt: performance.now(),
    path: [],
    depth: 0,
    truncated: false,
  };
  return als.run(ctx, work);
}

export function currentRequestContext(): RequestContext | undefined {
  return als.getStore();
}

/**
 * Registra um passo na ENTRADA do método e devolve o objeto guardado, para quem
 * chamou preencher `ms` (e `error`) na saída.
 *
 * A ordem é o motivo de ser assim. Registrar na saída daria ordem de TÉRMINO: a
 * chamada mais interna termina primeiro, então o repositório apareceria antes do
 * caso de uso que o chamou, e "o caminho percorrido" sairia de dentro para fora.
 * Registrar na entrada dá ordem de CHAMADA, que é o que a palavra caminho
 * significa.
 *
 * Devolve `undefined` — e é **no-op silencioso** — fora de uma requisição. Não é
 * caso de erro: o `DomainGaugesCollector` roda em timer e chama infraestrutura
 * decorada, e jobs futuros farão o mesmo. Nesses caminhos a span é criada
 * (correto) e a migalha é descartada (correto): não há requisição para a qual
 * desenhar caminho.
 */
export function pushStep(step: TraceStep): TraceStep | undefined {
  const ctx = als.getStore();
  if (!ctx) return undefined;

  if (ctx.path.length >= MAX_STEPS) {
    ctx.truncated = true;
    return undefined;
  }
  ctx.path.push(step);
  return step;
}

/**
 * Renderiza o caminho em uma linha, para o campo `path` do log de produção.
 *
 * Construído UMA vez, na emissão. Fazer isto no `mixin` do pino custaria
 * O(passos) por linha de log.
 */
export function formatPath(ctx: RequestContext): string {
  const passos = ctx.path.map((s) => {
    const nome = `${s.layer}/${s.class}.${s.fn}`;
    return s.error ? `${nome}!${s.error} ${s.ms}ms` : `${nome} ${s.ms}ms`;
  });

  const linha = passos.join(' → ');
  return ctx.truncated ? `${linha} → (+${MAX_STEPS}+ truncado)` : linha;
}
