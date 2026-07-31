/**
 * Teto de INATIVIDADE sobre um async iterable qualquer (Fase 9a — ADR 0040).
 *
 * Os providers que falam `node:http` ganham isso do socket (ver
 * `http-stream.ts`). O Anthropic continua no SDK oficial — que fala `fetch` e
 * só oferece timeout de requisição INTEIRA — então o mesmo contrato é honrado
 * uma camada acima: cada `next()` corre contra um relógio, e o relógio é
 * rearmado a cada evento. Um turno longo passa; um stream MUDO não.
 */
export async function* withIdleTimeout<T>(
  source: AsyncIterable<T>,
  timeoutMs: number,
  makeError: () => Error,
): AsyncGenerator<T> {
  const iterator = source[Symbol.asyncIterator]();

  try {
    for (;;) {
      const proximo = iterator.next();
      // Se o relógio vencer a corrida, esta promise fica órfã. Sem um handler
      // aqui, uma rejeição tardia dela viraria unhandledRejection e derrubaria
      // o processo — bem depois de o erro certo já ter sido reportado.
      proximo.catch(() => undefined);

      let relogio: NodeJS.Timeout | undefined;
      const estouro = new Promise<never>((_, reject) => {
        relogio = setTimeout(() => reject(makeError()), timeoutMs);
      });

      let resultado: IteratorResult<T>;
      try {
        resultado = await Promise.race([proximo, estouro]);
      } finally {
        clearTimeout(relogio);
      }

      if (resultado.done) return;
      yield resultado.value;
    }
  } finally {
    // Fecha o stream de verdade — sem isto o socket do SDK ficaria aberto
    // depois do estouro, que é exatamente o vazamento que o ADR 0020 caçou.
    // Falha ao fechar não pode SUBSTITUIR o erro que causou o fechamento: o
    // diagnóstico do usuário viraria "abort" em vez de "timeout".
    await iterator.return?.().catch(() => undefined);
  }
}
