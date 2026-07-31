/**
 * As rotas de infraestrutura que observabilidade nenhuma deve enxergar.
 *
 * As probes do Kubernetes e o scrape do Prometheus batem a cada poucos segundos,
 * para sempre. Instrumentá-las enterra o que interessa: no Tempo, milhares de
 * spans idênticas de `/live`; no Loki, um custo de retenção que é quase todo
 * ruído.
 *
 * Esta lista vivia copiada em três lugares (`tracing.ts`, o `autoLogging.ignore`
 * do `logger.config.ts` e agora o interceptor de caminho). Três cópias de uma
 * lista que precisa concordar é o tipo de duplicação que só se descobre quando
 * uma delas fica atrás — então é uma definição e três consumidores.
 */
const PREFIXOS_IGNORADOS = ['/live', '/health', '/metrics'] as const;

/**
 * `true` quando a URL é de rota de infraestrutura.
 *
 * Recebe a URL crua do request (com query string, se houver) porque é o que
 * tanto o `ignoreIncomingRequestHook` do OTel quanto o `autoLogging.ignore` do
 * pino-http entregam. `startsWith` basta: nenhuma rota de domínio começa com
 * esses prefixos.
 */
export function rotaIgnorada(url: string | undefined): boolean {
  const caminho = url ?? '';
  return PREFIXOS_IGNORADOS.some((prefixo) => caminho.startsWith(prefixo));
}
