import { describe, expect, it } from 'vitest';
import {
  resolverAnexos,
  type MensagemDeEntrada,
} from '../../../src/domain/llm/anexos-no-turno';
import { recortarEstado } from '../../../src/domain/llm/tool-router';

const PNG = Buffer.from('iVBORw0KGgo=', 'base64');
const msg = (...ids: string[]): MensagemDeEntrada[] => [
  {
    role: 'user',
    content: [
      { type: 'text', text: 'veja' },
      ...ids.map((id) => ({ type: 'anexo' as const, id })),
    ],
  },
];
const carregar = (id: string) =>
  Promise.resolve(
    id === 'img'
      ? { nome: 'a.png', mime: 'image/png', bytes: PNG }
      : id === 'txt'
        ? { nome: 'n.md', mime: 'text/markdown', bytes: Buffer.from('olá') }
        : null,
  );

describe('resolverAnexos (RN-989)', () => {
  it('texto puro continua string', async () => {
    const r = await resolverAnexos([{ role: 'user', content: 'oi' }], {
      visao: true,
      carregar,
    });
    expect(r[0].content).toBe('oi');
  });

  it('com visão a imagem vai como parte image com os bytes', async () => {
    const r = await resolverAnexos(msg('img'), { visao: true, carregar });
    expect(r[0].content).toEqual([
      { type: 'text', text: 'veja' },
      { type: 'image', mime: 'image/png', base64: PNG.toString('base64') },
    ]);
  });

  it('sem visão a imagem vira o texto de aviso, sem bytes', async () => {
    const r = await resolverAnexos(msg('img'), { visao: false, carregar });
    expect(JSON.stringify(r)).toContain(
      '[imagem a.png não enviada: o modelo atual não lê imagem]',
    );
    expect(JSON.stringify(r)).not.toContain(PNG.toString('base64'));
  });

  it('anexo de texto entra delimitado com o nome, mesmo sem visão; sumido é dito', async () => {
    const r = await resolverAnexos(msg('txt', 'sumiu'), {
      visao: false,
      carregar,
    });
    expect(r[0].content).toEqual([
      { type: 'text', text: 'veja' },
      { type: 'text', text: '[anexo: n.md]\nolá\n[fim do anexo: n.md]' },
      { type: 'text', text: '[anexo sumiu indisponível]' },
    ]);
  });

  it('o tool-router não quebra com conteúdo em array', async () => {
    const r = await resolverAnexos(msg('img'), { visao: true, carregar });
    const { estado } = recortarEstado('dev-x', [
      { role: 'system', content: [{ type: 'text', text: 'ctx' }] },
      ...r,
    ]);
    expect(estado.pedido.trim()).toBe('veja');
    expect(estado.contexto).toBe('ctx');
  });
});
