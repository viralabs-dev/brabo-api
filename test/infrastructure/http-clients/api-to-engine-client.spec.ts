import { describe, expect, it, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { BadRequestException } from '@nestjs/common';
import { HttpApiToEngineClient } from '../../../src/infrastructure/http-clients/api-to-engine-client';
import {
  RunnerNaoConectadoError,
  RunnerRecusouContainerError,
} from '../../../src/application/ports/api-to-engine-client.port';

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

describe('HttpApiToEngineClient — o runner sobe o container (ADR 0137)', () => {
  afterEach(() => {
    delete process.env.ENGINE_URL;
  });

  const SPEC = {
    workspaceDirName: 'proj-abc12345',
    projectSlug: 'proj-1',
    workspaceId: 'ws-1',
    imagem: 'node:22-bookworm-slim',
    imagemVersao: 3,
    rede: 'none' as const,
    cpus: 1,
    memoriaMb: 512,
    pidsLimit: 256,
  };

  it('startContainerViaRunner: `projectId` malformado é recusado ANTES de tocar a rede', async () => {
    process.env.ENGINE_URL = PORTA_QUE_NADA_ESCUTA;
    const client = new HttpApiToEngineClient();

    await expect(
      client.startContainerViaRunner('../../etc/passwd', SPEC),
    ).rejects.toThrow(BadRequestException);
  });

  it('startContainerViaRunner: caminho feliz — devolve containerId/nome/jaEstavaDePe', async () => {
    const server: Server = createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          sucesso: true,
          containerId: 'container-1',
          nome: 'brabo-proj-abc12345',
          jaEstavaDePe: false,
        }),
      );
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    process.env.ENGINE_URL = `http://127.0.0.1:${port}`;

    const client = new HttpApiToEngineClient();
    const resultado = await client.startContainerViaRunner(PROJETO, SPEC);

    expect(resultado).toEqual({
      containerId: 'container-1',
      nome: 'brabo-proj-abc12345',
      jaEstavaDePe: false,
    });

    await new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
  });

  it('startContainerViaRunner: motivoCodigo "not_connected" lança RunnerNaoConectadoError', async () => {
    const server: Server = createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          sucesso: false,
          motivoCodigo: 'not_connected',
          motivo: 'nenhum runner conectado a este projeto',
        }),
      );
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    process.env.ENGINE_URL = `http://127.0.0.1:${port}`;

    const client = new HttpApiToEngineClient();

    await expect(client.startContainerViaRunner(PROJETO, SPEC)).rejects.toBeInstanceOf(
      RunnerNaoConectadoError,
    );

    await new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
  });

  it('startContainerViaRunner: sucesso:false SEM motivoCodigo lança RunnerRecusouContainerError (o runner tentou e recusou)', async () => {
    const server: Server = createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ sucesso: false, motivo: 'Docker indisponível na máquina do usuário' }),
      );
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    process.env.ENGINE_URL = `http://127.0.0.1:${port}`;

    const client = new HttpApiToEngineClient();

    await expect(client.startContainerViaRunner(PROJETO, SPEC)).rejects.toBeInstanceOf(
      RunnerRecusouContainerError,
    );

    await new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
  });

  it('stopContainerViaRunner: `projectId` malformado é recusado ANTES de tocar a rede', async () => {
    process.env.ENGINE_URL = PORTA_QUE_NADA_ESCUTA;
    const client = new HttpApiToEngineClient();

    await expect(
      client.stopContainerViaRunner(
        '../../caminho-de-teste-sem-segredo',
        'workspace-de-teste',
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('stopContainerViaRunner: caminho feliz — POST .../containers/stop com workspaceDirName no corpo', async () => {
    let corpoRecebido: unknown;
    const server: Server = createServer((req, res) => {
      let bruto = '';
      req.on('data', (chunk) => (bruto += chunk));
      req.on('end', () => {
        corpoRecebido = JSON.parse(bruto);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ sucesso: true }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    process.env.ENGINE_URL = `http://127.0.0.1:${port}`;

    const client = new HttpApiToEngineClient();
    await expect(
      client.stopContainerViaRunner(PROJETO, 'proj-abc12345'),
    ).resolves.toBeUndefined();
    expect(corpoRecebido).toEqual({ workspaceDirName: 'proj-abc12345' });

    await new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
  });

  it('removeContainerViaRunner: timeout do engine lança RunnerNaoConectadoError', async () => {
    const server: Server = createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          sucesso: false,
          motivoCodigo: 'timeout',
          motivo: 'o runner não respondeu a tempo',
        }),
      );
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    process.env.ENGINE_URL = `http://127.0.0.1:${port}`;

    const client = new HttpApiToEngineClient();

    await expect(
      client.removeContainerViaRunner(PROJETO, 'proj-abc12345'),
    ).rejects.toBeInstanceOf(RunnerNaoConectadoError);

    await new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
  });
});
