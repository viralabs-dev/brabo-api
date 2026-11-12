import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import {
  interpretarCartao,
  interpretarDecisoes,
  MemoriaDoProjetoTranslator,
} from '../../../src/application/graph-projection/memoria-do-projeto-translator';
import type { GetModuleContractsUseCase } from '../../../src/application/use-cases/architecture/get-module-contracts.use-case';
import type { ReadProjectCodeUseCase } from '../../../src/application/use-cases/git/read-project-code.use-case';
import type { GraphStore } from '../../../src/infrastructure/graph/graph-store';

const CARTAO_API = `---
modulo: api
stack: node-ts
depende_de: [shared, db]
commit: abc123
---
# Módulo api

<!-- brabo:gerado -->
## Expõe

Ponto de entrada: \`src/index.ts\`
- \`criarPedido\` (function)
- \`GET /pedidos\` (rota)
- (+3 não mostrados)

## Scripts

- \`build\`: \`tsc\`
<!-- /brabo:gerado -->

## Como usar

- \`naoMe\` (function)
`;

function montar(opts: {
  arquivos: Record<string, string>;
  versao?: number | null;
}) {
  const run = vi.fn().mockResolvedValue({ records: [] });
  const graph = {
    executeWrite: (work: (tx: { run: typeof run }) => Promise<void>) =>
      work({ run }),
  } as unknown as GraphStore;
  const tree = vi.fn((_p: string, _r: string | undefined, caminho: string) => {
    const entries = Object.keys(opts.arquivos)
      .filter((c) => c.startsWith(`${caminho}/`))
      .map((path) => ({ path, type: 'file', size: 1 }));
    return entries.length
      ? Promise.resolve({ entries, truncated: false })
      : Promise.reject(new NotFoundException());
  });
  const readCode = {
    tree,
    file: vi.fn((_p: string, caminho: string) =>
      caminho in opts.arquivos
        ? Promise.resolve({ content: opts.arquivos[caminho] })
        : Promise.reject(new NotFoundException()),
    ),
  } as unknown as ReadProjectCodeUseCase;
  const contratos = {
    execute: () =>
      Promise.resolve(
        opts.versao == null
          ? { status: 'sem_contratos', version: 0, contratos: [] }
          : { status: 'declarados', version: opts.versao, contratos: [] },
      ),
  } as unknown as GetModuleContractsUseCase;
  return {
    run,
    tree,
    tradutor: new MemoriaDoProjetoTranslator(readCode, contratos, graph),
  };
}

const cypherDe = (run: ReturnType<typeof vi.fn>) =>
  run.mock.calls.map((c) => `${c[0] as string}|${JSON.stringify(c[1])}`);

describe('interpretarCartao', () => {
  it('lê front-matter e só a seção Expõe', () => {
    expect(interpretarCartao(CARTAO_API)).toEqual({
      nome: 'api',
      stack: 'node-ts',
      commit: 'abc123',
      dependeDe: ['shared', 'db'],
      expoe: [
        { assinatura: 'criarPedido', tipo: 'function' },
        { assinatura: 'GET /pedidos', tipo: 'rota' },
      ],
    });
  });

  it('sem front-matter ou sem `modulo` é malformado (null)', () => {
    expect(interpretarCartao('# nada')).toBeNull();
    expect(interpretarCartao('---\nstack: x\n---\n')).toBeNull();
  });
});

describe('interpretarDecisoes', () => {
  it('pega o id e os módulos citados', () => {
    const r = interpretarDecisoes(
      '# Decisões\n\n- ADR 0123 — pedidos em fila no `api`\n- ADR 0124 — sem módulo\nlixo',
      ['api', 'web'],
    );
    expect(r).toEqual([
      {
        id: '0123',
        titulo: 'ADR 0123 — pedidos em fila no `api`',
        modulos: ['api'],
      },
      { id: '0124', titulo: 'ADR 0124 — sem módulo', modulos: [] },
    ]);
  });
});

describe('MemoriaDoProjetoTranslator (RN-1163..1152)', () => {
  it('projeta módulo, dependências, interfaces, contrato do banco e decisões', async () => {
    const { run, tradutor } = montar({
      versao: 4,
      arquivos: {
        '.brabo/memoria/modulos/api.md': CARTAO_API,
        '.brabo/memoria/decisoes.md': '- ADR 0123 — fila no `api`\n',
      },
    });

    await expect(tradutor.projetar('p-1', 'sha1')).resolves.toBe(true);

    const todo = cypherDe(run).join('\n');
    expect(todo).toContain('MERGE (m:Modulo');
    expect(todo).toContain('"dep":"shared"');
    expect(todo).toContain('"dep":"db"');
    expect(todo).toContain('"assinatura":"criarPedido"');
    expect(todo).toContain('"assinatura":"GET /pedidos"');
    expect(todo).toContain('"versao":4');
    expect(todo).toContain('"id":"0123"');
    expect(todo).toContain('DETACH DELETE m'); // convergência
  });

  it('pasta de memória ausente não é falha e não grava nada', async () => {
    const { run, tradutor } = montar({ arquivos: {} });
    await expect(tradutor.projetar('p-1')).resolves.toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it('cartão malformado é pulado e os outros seguem', async () => {
    const { run, tradutor } = montar({
      arquivos: {
        '.brabo/memoria/modulos/a.md': 'sem front-matter',
        '.brabo/memoria/modulos/api.md': CARTAO_API,
      },
    });
    await tradutor.projetar('p-1');
    const todo = cypherDe(run).join('\n');
    expect(todo).toContain('"nome":"api"');
    expect(todo).not.toContain('sem front-matter');
  });

  it('sem contrato declarado não cria Contrato e remove o antigo', async () => {
    const { run, tradutor } = montar({
      versao: null,
      arquivos: { '.brabo/memoria/modulos/api.md': CARTAO_API },
    });
    await tradutor.projetar('p-1');
    const todo = cypherDe(run).join('\n');
    expect(todo).not.toContain('MERGE (c:Contrato');
    expect(todo).toContain('$versao IS NULL');
  });

  it('idempotência: dois merges iguais geram as mesmas escritas', async () => {
    const arquivos = { '.brabo/memoria/modulos/api.md': CARTAO_API };
    const a = montar({ versao: 2, arquivos });
    const b = montar({ versao: 2, arquivos });
    await a.tradutor.projetar('p-1', 'x');
    await b.tradutor.projetar('p-1', 'x');
    await b.tradutor.projetar('p-1', 'x');
    expect(cypherDe(b.run)).toEqual([...cypherDe(a.run), ...cypherDe(a.run)]);
  });

  it('erro de leitura que não é NotFound propaga (a linha da outbox fica para retry)', async () => {
    const { tree, tradutor } = montar({ arquivos: {} });
    tree.mockRejectedValue(new Error('rate limit'));
    await expect(tradutor.projetar('p-1')).rejects.toThrow('rate limit');
  });
});
