import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Servidor de LLM falso para a suite de contrato (Fase 9a — ADR 0040).
 *
 * Segue o molde do teste de transporte do Ollama da Fase 4 (`node:http` de
 * verdade em porta efêmera, não mock de `fetch`): o que está sob teste é
 * justamente o comportamento de socket — chunk partido, servidor mudo, status
 * de erro. Um mock de `fetch` responderia sempre bonitinho e não provaria nada.
 */
export type CenarioLLM =
  /** Deltas de texto, com uma linha PARTIDA entre dois writes. */
  | 'stream_ok'
  /** Stream normal + contagem de tokens informada pelo provider. */
  | 'com_usage'
  /** Stream normal SEM nenhuma contagem de tokens. */
  | 'sem_usage'
  /** O modelo pede uma ferramenta. */
  | 'tool_call'
  | 'erro_401'
  | 'erro_404'
  | 'erro_429'
  | 'erro_413'
  /** Aceita a conexão e nunca responde — nem headers. */
  | 'mudo';

/** Cada provider traduz o cenário para o SEU formato de fio. */
export type Dialeto = (cenario: CenarioLLM, res: ServerResponse) => void;

export interface ServidorFalso {
  baseUrl: string;
  /** Define o cenário que a PRÓXIMA requisição vai receber. */
  usar: (cenario: CenarioLLM) => void;
  /** Corpo JSON da última requisição — para conferir o que foi enviado. */
  ultimoPedido: () => Record<string, unknown> | undefined;
  fechar: () => Promise<void>;
}

export async function subirServidorFalso(
  dialeto: Dialeto,
): Promise<ServidorFalso> {
  let cenario: CenarioLLM = 'stream_ok';
  let ultimo: Record<string, unknown> | undefined;

  const server: Server = createServer((req, res) => {
    const pedacos: Buffer[] = [];
    req.on('data', (pedaco: Buffer) => pedacos.push(pedaco));
    req.on('end', () => {
      try {
        ultimo = JSON.parse(Buffer.concat(pedacos).toString('utf8')) as Record<
          string,
          unknown
        >;
      } catch {
        ultimo = undefined;
      }

      // Nunca responde — nem headers. É o caso real do ADR 0020: o provider
      // enfileirou a requisição atrás de outra e o socket ficou mudo.
      if (cenario === 'mudo') return;

      dialeto(cenario, res);
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    usar: (novo) => {
      cenario = novo;
    },
    ultimoPedido: () => ultimo,
    fechar: () =>
      new Promise<void>((resolve) => {
        // `closeAllConnections` é obrigatório por causa do cenário `mudo`: o
        // socket pendurado impediria o `close` de completar e o teste
        // estouraria por timeout em vez de terminar.
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** Status HTTP de cada cenário de erro — igual para todos os dialetos. */
export const STATUS_DO_CENARIO: Partial<Record<CenarioLLM, number>> = {
  erro_401: 401,
  erro_404: 404,
  erro_429: 429,
  erro_413: 413,
};

export function ehCenarioDeErro(cenario: CenarioLLM): boolean {
  return cenario in STATUS_DO_CENARIO;
}

/** O texto que os deltas do cenário feliz devem reconstruir. */
export const TEXTO_ESPERADO = 'oi mundo';
export const PEDACOS_DO_TEXTO = ['oi', ' mundo'] as const;

/** A ferramenta que o cenário `tool_call` pede. */
export const FERRAMENTA_ESPERADA = {
  name: 'ler_arquivo',
  arguments: { caminho: 'README.md' },
} as const;

export const USAGE_ESPERADO = { inputTokens: 7, outputTokens: 3 } as const;
