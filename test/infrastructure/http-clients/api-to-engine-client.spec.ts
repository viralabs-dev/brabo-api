import { describe, expect, it, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { BadRequestException } from '@nestjs/common';
import { HttpApiToEngineClient } from '../../../src/infrastructure/http-clients/api-to-engine-client';

/**
 * `sessionId`/`projectId`/`agent`/`agentId` viram segmento de URL de uma
 * requisição interna api -> engine sem DTO/`class-validator` no meio (RN-128,
 * CodeQL "URL de requisição interna montada com valor não validado").
 *
 * A prova de que a validação acontece ANTES do transporte é a MESMA usada em
 * `llm-credential-connection-tester.spec.ts`: apontar `ENGINE_URL` pra uma
 * porta que nada escuta — se a chamada malformada chegasse a tentar a rede,
 * o erro seria de conexão recusada, não `BadRequestException`.
 */

const PORTA_QUE_NADA_ESCUTA = 'http://127.0.0.1:1';
const PROJETO = '3f2b1c8e-0a5d-4f6b-9c1e-2d7a8b3c4d5e';
const SESSAO = 'a1b2c3d4-0000-4000-8000-000000000000';

async function subirServidorEngine(): Promise<{
  baseUrl: string;
  chamadas: string[];
  fechar: () => Promise<void>;
}> {
  const chamadas: string[] = [];
  const server: Server = createServer((req, res) => {
    chamadas.push(req.url ?? '');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{}');
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    chamadas,
    fechar: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

describe('HttpApiToEngineClient — validação de segmento de URL interna (RN-128)', () => {
  afterEach(() => {
    delete process.env.ENGINE_URL;
  });

  it('startAgent: `sessionId` malformado é recusado ANTES de tocar a rede', async () => {
    process.env.ENGINE_URL = PORTA_QUE_NADA_ESCUTA;
    const client = new HttpApiToEngineClient();

    await expect(
      client.startAgent(PROJETO, '../../etc/passwd', 'arquiteto'),
    ).rejects.toThrow(BadRequestException);
  });

  it('startAgent: caminho feliz — ids válidos chegam a fazer a requisição', async () => {
    const servidor = await subirServidorEngine();
    process.env.ENGINE_URL = servidor.baseUrl;
    const client = new HttpApiToEngineClient();

    await expect(
      client.startAgent(PROJETO, SESSAO, 'arquiteto'),
    ).resolves.toBeUndefined();
    expect(servidor.chamadas).toEqual([
      `/internal/sessions/${SESSAO}/agent/start`,
    ]);

    await servidor.fechar();
  });

  it('invalidateInstructions: `agent` malformado é recusado (projectId e agent são os DOIS segmentos)', async () => {
    process.env.ENGINE_URL = PORTA_QUE_NADA_ESCUTA;
    const client = new HttpApiToEngineClient();

    await expect(
      client.invalidateInstructions(PROJETO, 'agente/../outro'),
    ).rejects.toThrow(BadRequestException);
  });

  it('rearmDevAgent: `agentId` malformado é recusado mesmo com `sessionId` válido', async () => {
    process.env.ENGINE_URL = PORTA_QUE_NADA_ESCUTA;
    const client = new HttpApiToEngineClient();

    await expect(
      client.rearmDevAgent(PROJETO, SESSAO, 'a b c/malformado'),
    ).rejects.toThrow(BadRequestException);
  });

  it('reanalyzeSession: não usa postCommand, e ainda assim recusa `sessionId` malformado', async () => {
    process.env.ENGINE_URL = PORTA_QUE_NADA_ESCUTA;
    const client = new HttpApiToEngineClient();

    await expect(
      client.reanalyzeSession(PROJETO, '../../internal/outra-rota'),
    ).rejects.toThrow(BadRequestException);
  });

  it('runAnamnese: não usa postCommand, e ainda assim recusa `projectId` malformado', async () => {
    process.env.ENGINE_URL = PORTA_QUE_NADA_ESCUTA;
    const client = new HttpApiToEngineClient();

    await expect(
      client.runAnamnese('../../internal/outra-rota'),
    ).rejects.toThrow(BadRequestException);
  });

  it('reanalyzeSession: caminho feliz — `sessionId` válido chega a fazer a requisição', async () => {
    const servidor = await subirServidorEngine();
    process.env.ENGINE_URL = servidor.baseUrl;
    const client = new HttpApiToEngineClient();

    await expect(
      client.reanalyzeSession(PROJETO, SESSAO),
    ).resolves.toBeUndefined();
    expect(servidor.chamadas).toEqual([
      `/internal/sessions/${SESSAO}/psychologist/reanalyze`,
    ]);

    await servidor.fechar();
  });

  it('getPsychologistStatus: sem segmento de URL variável — lê o corpo da resposta do engine (RN-454)', async () => {
    const server: Server = createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ enabled: false }));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const { port } = server.address() as AddressInfo;
    process.env.ENGINE_URL = `http://127.0.0.1:${port}`;

    const client = new HttpApiToEngineClient();
    const resultado = await client.getPsychologistStatus();

    expect(resultado).toEqual({ enabled: false });

    await new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
  });

  it('requestRunnerTicket: `projectId` malformado é recusado ANTES de tocar a rede', async () => {
    process.env.ENGINE_URL = PORTA_QUE_NADA_ESCUTA;
    const client = new HttpApiToEngineClient();

    await expect(
      client.requestRunnerTicket('../../etc/passwd', 'user-1', 'runner'),
    ).rejects.toThrow(BadRequestException);
  });

  it('requestRunnerTicket: caminho feliz — devolve ticket/expiresAt do corpo da resposta do engine', async () => {
    const expiresAt = new Date(Date.now() + 30_000).toISOString();
    const server: Server = createServer((req, res) => {
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ticket: 'ticket-bruto-do-engine', expiresAt }));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const { port } = server.address() as AddressInfo;
    process.env.ENGINE_URL = `http://127.0.0.1:${port}`;

    const client = new HttpApiToEngineClient();
    const resultado = await client.requestRunnerTicket(
      PROJETO,
      'user-1',
      'runner',
    );

    expect(resultado.ticket).toBe('ticket-bruto-do-engine');
    expect(resultado.expiresAt.toISOString()).toBe(expiresAt);

    await new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
  });
});
