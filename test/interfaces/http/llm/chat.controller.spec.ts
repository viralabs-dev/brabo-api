import { describe, it, expect, afterEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { UnprocessableEntityException } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { ChatController } from '../../../../src/interfaces/http/llm/chat.controller';
import { SendChatMessageUseCase } from '../../../../src/application/use-cases/llm/send-chat-message.use-case';
import { GarantirDestinatarioDoChatUseCase } from '../../../../src/application/use-cases/llm/garantir-destinatario-do-chat.use-case';
import {
  MENSAGEM_CHAT_SEM_DESTINATARIO,
  MOTIVO_CHAT_SEM_DESTINATARIO,
} from '../../../../src/domain/sessions/chat-sem-destinatario';

/**
 * RN-682 (AT-254): a recusa da consultiva sem agente tem de chegar como
 * RESPOSTA HTTP (422 nomeado), e não como um quadro `error` dentro de um
 * stream 200 — senão um cliente que não seja a tela leria "deu certo". A rota
 * é SSE, e é por isso que o teste sobe o Nest de verdade: só o
 * `RouterResponseController` decide se a rejeição do handler sai antes do
 * cabeçalho do stream.
 */

let app: NestExpressApplication | undefined;

async function subir(garantir: () => Promise<void>) {
  const enviar = vi.fn(async function* () {
    await Promise.resolve();
    yield { type: 'delta' as const, text: 'oi' };
  });
  const modulo = await Test.createTestingModule({
    controllers: [ChatController],
    providers: [
      { provide: SendChatMessageUseCase, useValue: { execute: enviar } },
      {
        provide: GarantirDestinatarioDoChatUseCase,
        useValue: { execute: garantir },
      },
    ],
  }).compile();
  app = modulo.createNestApplication<NestExpressApplication>({ logger: false });
  // O `@CurrentUser()` lê `req.user`; o guard de auth não está montado aqui.
  app.use((req: { user?: unknown }, _res: unknown, next: () => void) => {
    req.user = { id: 'u1' };
    next();
  });
  await app.init();
  return { servidor: app.getHttpServer(), enviar };
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('POST .../chat — destinatário (RN-682)', () => {
  it('consultiva sem agente: 422 `destinatario_ausente` como resposta HTTP, e o modelo não é chamado', async () => {
    const { servidor, enviar } = await subir(() =>
      Promise.reject(
        new UnprocessableEntityException({
          message: MENSAGEM_CHAT_SEM_DESTINATARIO,
          reason: MOTIVO_CHAT_SEM_DESTINATARIO,
        }),
      ),
    );

    const resposta = await request(servidor)
      .post('/projects/p1/sessions/s1/chat')
      .send({ text: 'oi' });

    expect(resposta.status).toBe(422);
    expect(resposta.headers['content-type']).toMatch(/application\/json/);
    expect(resposta.body).toMatchObject({
      reason: 'destinatario_ausente',
      message: MENSAGEM_CHAT_SEM_DESTINATARIO,
    });
    expect(enviar).not.toHaveBeenCalled();
  });

  it('caminho feliz: com a guarda passando, a rota segue sendo o stream de sempre', async () => {
    const { servidor, enviar } = await subir(() => Promise.resolve());

    const resposta = await request(servidor)
      .post('/projects/p1/sessions/s1/chat')
      .send({ text: 'oi' });

    // 201: o status padrão de POST no Nest, o mesmo de antes desta guarda.
    expect(resposta.status).toBe(201);
    expect(resposta.headers['content-type']).toMatch(/text\/event-stream/);
    expect(resposta.text).toContain('"type":"delta"');
    expect(enviar).toHaveBeenCalledOnce();
  });
});
