import { describe, expect, it, vi } from 'vitest';
import { Reflector } from '@nestjs/core';
import { RunnerTicketsController } from '../../../../src/interfaces/http/runner/runner-tickets.controller';
import { REQUIRED_ROLE_KEY } from '../../../../src/interfaces/http/iam/require-role.decorator';
import type { User } from '../../../../src/domain/iam/user.entity';

const user = { id: 'user-1' } as User;

describe('RunnerTicketsController', () => {
  it('runner-ticket exige developer — o mesmo papel mínimo de ações de terminal', () => {
    const reflector = new Reflector();
    expect(
      reflector.get(
        REQUIRED_ROLE_KEY,
        RunnerTicketsController.prototype.runnerTicket,
      ),
    ).toBe('developer');
  });

  it('terminal-ticket exige só viewer — quem vê o terminal, não quem o comanda', () => {
    const reflector = new Reflector();
    expect(
      reflector.get(
        REQUIRED_ROLE_KEY,
        RunnerTicketsController.prototype.terminalTicket,
      ),
    ).toBe('viewer');
  });

  it('runner-ticket: delega ao use case com kind "runner" e serializa a resposta', async () => {
    const expiresAt = new Date('2026-08-19T12:00:30.000Z');
    const requestTicket = {
      execute: vi.fn().mockResolvedValue({
        ticket: 'bruto-runner',
        expiresAt,
        engineWsUrl: 'ws://localhost:4000/runner',
      }),
    };
    const controller = new RunnerTicketsController(requestTicket as never);

    const resposta = await controller.runnerTicket('projeto-1', user);

    expect(requestTicket.execute).toHaveBeenCalledWith(
      'projeto-1',
      'user-1',
      'runner',
    );
    expect(resposta).toEqual({
      ticket: 'bruto-runner',
      expiresAt: '2026-08-19T12:00:30.000Z',
      engineWsUrl: 'ws://localhost:4000/runner',
    });
  });

  it('terminal-ticket: delega ao use case com kind "terminal"', async () => {
    const expiresAt = new Date('2026-08-19T12:00:30.000Z');
    const requestTicket = {
      execute: vi.fn().mockResolvedValue({
        ticket: 'bruto-terminal',
        expiresAt,
        engineWsUrl: 'ws://localhost:4000/runner',
      }),
    };
    const controller = new RunnerTicketsController(requestTicket as never);

    const resposta = await controller.terminalTicket('projeto-1', user);

    expect(requestTicket.execute).toHaveBeenCalledWith(
      'projeto-1',
      'user-1',
      'terminal',
    );
    expect(resposta.ticket).toBe('bruto-terminal');
  });
});
