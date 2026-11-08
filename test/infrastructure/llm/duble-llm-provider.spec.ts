import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChatStreamChunk } from '@brabo/shared';
import { describe, expect, it } from 'vitest';
import {
  dubleSeAutorizado,
  MODELO_DUBLE,
} from '../../../src/infrastructure/llm/duble-llm-provider';

const dir = mkdtempSync(join(tmpdir(), 'duble-'));
const roteiro = join(dir, 'roteiro.json');
writeFileSync(
  roteiro,
  JSON.stringify({
    agentes: {
      criativo: [
        { texto: 'oi' },
        { tool_calls: [{ name: 'criar_epico', arguments: { titulo: 'x' } }] },
      ],
      '*': [{ texto: 'curinga' }],
    },
  }),
);
const marca = (m: string) => () => m;
const semMarca = () => {
  throw new Error('ENOENT');
};

async function juntar(it: AsyncIterable<ChatStreamChunk>) {
  const out: ChatStreamChunk[] = [];
  for await (const c of it) out.push(c);
  return out;
}

describe('guarda do provider dublê (AT-815, RN-1065)', () => {
  const casos: [string, NodeJS.ProcessEnv, () => string, boolean][] = [
    [
      'variável sim, sem marca',
      { LLM_DUBLE: '1', LLM_DUBLE_ROTEIRO: roteiro },
      semMarca,
      true,
    ],
    [
      'variável sim, marca dev',
      { LLM_DUBLE: '1', LLM_DUBLE_ROTEIRO: roteiro },
      marca('dev'),
      true,
    ],
    [
      'variável sim, marca prd',
      { LLM_DUBLE: '1', LLM_DUBLE_ROTEIRO: roteiro },
      marca('prd\n'),
      false,
    ],
    [
      'variável não, sem marca',
      { LLM_DUBLE_ROTEIRO: roteiro },
      semMarca,
      false,
    ],
    [
      'variável 0, marca dev',
      { LLM_DUBLE: '0', LLM_DUBLE_ROTEIRO: roteiro },
      marca('dev'),
      false,
    ],
  ];
  it.each(casos)('%s', (_n, env, ler, carrega) => {
    const avisos: string[] = [];
    const p = dubleSeAutorizado((m) => avisos.push(m), env, ler);
    expect(p !== null).toBe(carrega);
    if (_n.endsWith('marca prd')) expect(avisos[0]).toMatch(/prd/);
  });

  it('liga sem roteiro: falha alto', () => {
    expect(() =>
      dubleSeAutorizado(() => {}, { LLM_DUBLE: '1' }, semMarca),
    ).toThrow(/LLM_DUBLE_ROTEIRO/);
  });
});

describe('roteiro do dublê', () => {
  const novo = () =>
    dubleSeAutorizado(
      () => {},
      { LLM_DUBLE: '1', LLM_DUBLE_ROTEIRO: roteiro },
      semMarca,
    )!;

  it('um passo por chamada, por agente; repete o último; custo 0 e modelo dublê', async () => {
    const p = novo();
    const op = { model: 'm', sessionKey: 'brabo:s1:criativo' };
    const a = await juntar(p.chat([], op));
    expect(a[0]).toEqual({ type: 'text_delta', text: 'oi' });
    expect(a.at(-1)).toMatchObject({
      type: 'usage',
      costMicros: 0,
      resolvedModel: MODELO_DUBLE,
    });
    const b = await juntar(p.chat([], op));
    expect(b[0]).toMatchObject({
      type: 'tool_calls',
      toolCalls: [{ name: 'criar_epico', arguments: { titulo: 'x' } }],
    });
    const c = await juntar(p.chat([], op));
    expect(c[0]?.type).toBe('tool_calls'); // repete o último
  });

  it('agente fora do roteiro cai no "*"; outra sessão recomeça', async () => {
    const p = novo();
    const r = await juntar(
      p.chat([], { model: 'm', sessionKey: 'brabo:s2:outro' }),
    );
    expect(r[0]).toEqual({ type: 'text_delta', text: 'curinga' });
    const s = await juntar(
      p.chat([], { model: 'm', sessionKey: 'brabo:s3:criativo' }),
    );
    expect(s[0]).toEqual({ type: 'text_delta', text: 'oi' });
  });
});
