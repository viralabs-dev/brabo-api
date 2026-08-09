import { describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { DecidirImagemDoProjetoUseCase } from '../../../../src/application/use-cases/containers/decidir-imagem-do-projeto.use-case';
import { ObterContainerDoProjetoUseCase } from '../../../../src/application/use-cases/containers/obter-container-do-projeto.use-case';
import type { AppendSessionEventUseCase } from '../../../../src/application/use-cases/sessions/append-session-event.use-case';
import type { SessionEventRepository } from '../../../../src/application/ports/session-event-repository.port';
import type { SessionEvent } from '../../../../src/domain/sessions/session-event.entity';
import {
  EVENTO_IMAGEM_DO_PROJETO,
  RECURSOS_PADRAO,
} from '../../../../src/domain/containers/project-container';

const PROJETO = 'proj-1';
const SESSAO = 'sess-1';
const RATIONALE = 'o module_map é TypeScript sobre Node 22';

/**
 * O event log falso é o REGISTRO do artefato — não há tabela (ADR 0065). Ele
 * grava o que o caso de uso emitiu e devolve como `listByTypeForProject`, que
 * é exatamente o par que o produto usa.
 */
function montar(eventosIniciais: SessionEvent[] = []) {
  const eventos = [...eventosIniciais];
  let seq = eventos.length;

  const repo = {
    listByTypeForProject: (_projectId: string, type: string) =>
      Promise.resolve(eventos.filter((e) => e.type === type)),
  } as unknown as SessionEventRepository;

  const append = {
    execute: (
      _projectId: string,
      sessionId: string,
      input: { type: string; actor: { kind: string; id: string }; payload: unknown },
    ) => {
      seq += 1;
      eventos.push({
        id: `evt-${seq}`,
        sessionId,
        seq,
        type: input.type,
        actor: input.actor as SessionEvent['actor'],
        payload: input.payload,
        createdAt: new Date('2026-08-09T00:00:00Z'),
      });
      return Promise.resolve(eventos[eventos.length - 1]);
    },
  } as unknown as AppendSessionEventUseCase;

  const obter = new ObterContainerDoProjetoUseCase(repo);
  const decidir = new DecidirImagemDoProjetoUseCase(append, obter);

  return { obter, decidir, eventos };
}

describe('ObterContainerDoProjetoUseCase — o portão (RN-105)', () => {
  it('projeto novo nasce `sem_decisao`: não há container e a aba Code não abre', async () => {
    const { obter } = montar();
    const estado = await obter.execute(PROJETO);

    expect(estado.status).toBe('sem_decisao');
    expect(estado.decisao).toBeNull();
    expect(estado.version).toBe(0);
  });

  it('depois da decisão do Arquiteto, o estado é `decidido`', async () => {
    const { obter, decidir } = montar();
    await decidir.execute(PROJETO, SESSAO, {
      image: 'node:22-bookworm-slim',
      rationale: RATIONALE,
    });

    const estado = await obter.execute(PROJETO);
    expect(estado.status).toBe('decidido');
    expect(estado.decisao?.image).toBe('node:22-bookworm-slim');
    expect(estado.decisao?.network).toBe('none');
    expect(estado.decisao?.resources).toEqual(RECURSOS_PADRAO);
    expect(estado.eventId).toBe('evt-1');
  });

  it('o vigente é o de maior `version`, e a versão antiga continua no log', async () => {
    const { obter, decidir, eventos } = montar();
    await decidir.execute(PROJETO, SESSAO, {
      image: 'node:20-slim',
      rationale: RATIONALE,
    });
    await decidir.execute(PROJETO, SESSAO, {
      image: 'node:22-bookworm-slim',
      rationale: 'a 20 saiu de suporte',
    });

    const estado = await obter.execute(PROJETO);
    expect(estado.version).toBe(2);
    expect(estado.decisao?.image).toBe('node:22-bookworm-slim');
    // Histórico imutável: revisar é emitir de novo, nunca sobrescrever.
    expect(eventos.filter((e) => e.type === EVENTO_IMAGEM_DO_PROJETO)).toHaveLength(2);
  });

  it('a ordem não depende de o repositório devolver ordenado', async () => {
    // Com `listByTypeForProject` devolvendo ao contrário, o vigente tem de
    // continuar sendo o mesmo: quem decide é `version`, não a posição.
    const { obter, decidir, eventos } = montar();
    await decidir.execute(PROJETO, SESSAO, {
      image: 'node:20-slim',
      rationale: RATIONALE,
    });
    await decidir.execute(PROJETO, SESSAO, {
      image: 'node:22-slim',
      rationale: RATIONALE,
    });
    eventos.reverse();

    expect((await obter.execute(PROJETO)).decisao?.image).toBe('node:22-slim');
  });

  it('payload ilegível degrada em vez de fechar a aba de quem já passou pelo portão', async () => {
    const antigo: SessionEvent = {
      id: 'evt-antigo',
      sessionId: SESSAO,
      seq: 1,
      type: EVENTO_IMAGEM_DO_PROJETO,
      actor: { kind: 'agent', id: 'arquiteto' },
      payload: { image: 'node:latest', version: 1 },
      createdAt: new Date('2026-01-01T00:00:00Z'),
    };
    const { obter } = montar([antigo]);

    const estado = await obter.execute(PROJETO);
    expect(estado.status).toBe('decidido');
    expect(estado.decisao?.image).toBe('node:latest');
  });
});

describe('DecidirImagemDoProjetoUseCase', () => {
  it('emite `artifact.project_image` com o Arquiteto como autor', async () => {
    const { decidir, eventos } = montar();
    await decidir.execute(PROJETO, SESSAO, {
      image: 'python:3.12-slim',
      rationale: 'o module_map é Python; a slim tem o runtime e nada mais',
    });

    const evento = eventos.at(-1)!;
    expect(evento.type).toBe(EVENTO_IMAGEM_DO_PROJETO);
    expect(evento.actor).toEqual({ kind: 'agent', id: 'arquiteto' });
    expect(evento.payload).toMatchObject({
      image: 'python:3.12-slim',
      network: 'none',
      version: 1,
    });
  });

  it('imagem inválida vira 400 com o motivo — e NÃO grava evento nenhum', async () => {
    const { decidir, eventos } = montar();

    await expect(
      decidir.execute(PROJETO, SESSAO, {
        image: 'node:latest',
        rationale: RATIONALE,
      }),
    ).rejects.toThrow(BadRequestException);

    expect(eventos).toHaveLength(0);
  });

  it('`egress` é gravado como o Arquiteto pediu — a rede é decidida no artefato', async () => {
    const { decidir, eventos } = montar();
    await decidir.execute(PROJETO, SESSAO, {
      image: 'node:22-slim',
      rationale: 'a build baixa dependências do registry público',
      network: 'egress',
    });

    expect(eventos.at(-1)!.payload).toMatchObject({ network: 'egress' });
  });
});
