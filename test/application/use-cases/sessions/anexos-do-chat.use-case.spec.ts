import { describe, it, expect } from 'vitest';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { AnexosDoChatUseCase } from '../../../../src/application/use-cases/sessions/anexos-do-chat.use-case';
import { SendAgentMessageUseCase } from '../../../../src/application/use-cases/agents/send-agent-message.use-case';
import type { ChatAttachmentRow } from '../../../../src/application/ports/chat-attachment-repository.port';

const PNG = Buffer.concat([
  Buffer.from('89504e470d0a1a0a', 'hex'),
  Buffer.alloc(32),
]);
const b64 = (b: Buffer) => b.toString('base64');

function montar(status = 'active') {
  const linhas: ChatAttachmentRow[] = [];
  const sessions = {
    findInProject: (p: string, s: string) =>
      Promise.resolve(p === 'p' && s === 's' ? { id: s, status } : null),
  };
  const repo = {
    create: (i: Omit<ChatAttachmentRow, 'id'>) => {
      const id = `a${linhas.length + 1}`;
      linhas.push({ id, ...i });
      return Promise.resolve({ id });
    },
    find: (p: string, s: string, id: string) =>
      Promise.resolve(
        linhas.find(
          (l) => l.id === id && l.projectId === p && l.sessionId === s,
        ) ?? null,
      ),
    findManyMeta: (p: string, s: string, ids: string[]) =>
      Promise.resolve(
        linhas.filter(
          (l) => ids.includes(l.id) && l.projectId === p && l.sessionId === s,
        ),
      ),
  };
  const uc = new AnexosDoChatUseCase(sessions as never, repo);
  return { uc, linhas };
}

// RN-986: tetos e tipo pelos BYTES.
describe('AnexosDoChatUseCase.enviar (RN-986)', () => {
  it('imagem: o MIME vem dos bytes, não do nome', async () => {
    const { uc } = montar();
    const r = await uc.enviar('p', 's', 'u', 'foto.txt', b64(PNG));
    expect(r).toEqual({
      id: 'a1',
      nome: 'foto.txt',
      mime: 'image/png',
      tamanho: PNG.length,
    });
  });

  it('texto UTF-8 vira text/plain', async () => {
    const { uc } = montar();
    const r = await uc.enviar('p', 's', 'u', 'a.ts', b64(Buffer.from('ok')));
    expect(r.mime).toBe('text/plain');
  });

  it('415: binário que não é imagem aceita', async () => {
    const { uc } = montar();
    await expect(
      uc.enviar('p', 's', 'u', 'x.bin', b64(Buffer.from([0xff, 0x00, 0x01]))),
    ).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
  });

  it('413: imagem de 5 MB + 1 e texto de 512 KB + 1', async () => {
    const { uc } = montar();
    const img = Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]);
    await expect(
      uc.enviar('p', 's', 'u', 'g.png', b64(img)),
    ).rejects.toBeInstanceOf(PayloadTooLargeException);
    const txt = Buffer.alloc(512 * 1024 + 1, 'a');
    await expect(
      uc.enviar('p', 's', 'u', 'g.txt', b64(txt)),
    ).rejects.toBeInstanceOf(PayloadTooLargeException);
  });

  it('409 sessao_encerrada em sessão terminal (RN-581)', async () => {
    const { uc } = montar('closed');
    await expect(
      uc.enviar('p', 's', 'u', 'a.txt', b64(Buffer.from('x'))),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

// RN-988: leitura escopada ao projeto e à sessão.
describe('AnexosDoChatUseCase.ler (RN-988)', () => {
  it('devolve os bytes; projeto ou sessão alheios dão 404', async () => {
    const { uc } = montar();
    await uc.enviar('p', 's', 'u', 'a.txt', b64(Buffer.from('x')));
    expect((await uc.ler('p', 's', 'a1')).mime).toBe('text/plain');
    await expect(uc.ler('outro', 's', 'a1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(uc.ler('p', 's', 'nao-existe')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

// RN-987: o evento guarda a referência, nunca os bytes.
describe('envio de mensagem com anexos (RN-987)', () => {
  async function enviarMsg(ids: string[], preparar = true) {
    const { uc, linhas } = montar();
    if (preparar) {
      await uc.enviar('p', 's', 'u', 'a.txt', b64(Buffer.from('x')));
      await uc.enviar('p', 's', 'outro', 'b.txt', b64(Buffer.from('y')));
    }
    const eventos: Array<{ payload: Record<string, unknown> }> = [];
    const paraOEngine: unknown[] = [];
    const envio = new SendAgentMessageUseCase(
      {
        sendAgentMessage: (...args: unknown[]) => {
          paraOEngine.push(args[7]);
          return Promise.resolve({ entrega: 'lida' });
        },
      } as never,
      {
        execute: (_p: string, _s: string, e: never) => {
          eventos.push(e);
          return Promise.resolve({ id: 'evt' });
        },
      } as never,
      { execute: () => Promise.resolve(null) } as never,
      {
        execute: () => Promise.resolve({ facts: [], factsTotal: 0 }),
      } as never,
      { listByUser: () => Promise.resolve([]) } as never,
      uc,
    );
    return { envio, eventos, paraOEngine, linhas };
  }

  it('grava só a referência no chat.message e a leva ao engine', async () => {
    const { envio, eventos, paraOEngine } = await enviarMsg([]);
    await envio.execute('p', 's', 'po', 'veja', 'u', ['a1']);
    const ref = [{ id: 'a1', nome: 'a.txt', mime: 'text/plain', tamanho: 1 }];
    expect(eventos[0].payload.anexos).toEqual(ref);
    expect(JSON.stringify(eventos[0].payload)).not.toContain('bytes');
    expect(paraOEngine).toEqual([ref]);
  });

  it('400: mais de 4 anexos', async () => {
    const { envio } = await enviarMsg([], false);
    await expect(
      envio.execute('p', 's', 'po', 'x', 'u', ['1', '2', '3', '4', '5']),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('400: anexo de outra sessão, inexistente ou de outro autor', async () => {
    const { envio } = await enviarMsg([]);
    await expect(
      envio.execute('p', 'outra', 'po', 'x', 'u', ['a1']),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      envio.execute('p', 's', 'po', 'x', 'u', ['a2']),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
