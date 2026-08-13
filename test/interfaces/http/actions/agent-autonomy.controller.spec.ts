import { describe, it, expect } from 'vitest';
import { Reflector } from '@nestjs/core';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { AgentAutonomyController } from '../../../../src/interfaces/http/actions/agent-autonomy.controller';
import { REQUIRED_ROLE_KEY } from '../../../../src/interfaces/http/iam/require-role.decorator';
import { SetAgentAutonomyDto } from '../../../../src/interfaces/http/actions/dto/set-agent-autonomy.dto';

/**
 * Trava específica do "auto mode" (RN-153): o endpoint que grava a curinga
 * `actionType: "*"` é o MESMO `PUT /projects/:projectId/agent-autonomy` de
 * sempre, e continua exigindo `maintainer` — não ganhou um caminho novo que
 * pudesse esquecer o `@RequireRole`.
 *
 * `RolesGuard` (roles.guard.spec.ts) já prova que a matriz de papéis funciona
 * em geral; este teste prova que ESTE handler específico está anotado, o que
 * é o que faz a matriz valer para ele. `route-surface.spec.ts` prova o mesmo
 * fato contra `docs/security-surface.md` em runtime — este é o companheiro
 * rápido, sem subir o `AppModule`.
 */
describe('AgentAutonomyController — papel exigido pra ligar/desligar o auto mode', () => {
  const reflector = new Reflector();

  it('GET exige maintainer', () => {
    const papel = reflector.get(REQUIRED_ROLE_KEY, AgentAutonomyController.prototype.list);
    expect(papel).toBe('maintainer');
  });

  it('PUT (liga a curinga "*" — auto mode) exige maintainer', () => {
    const papel = reflector.get(REQUIRED_ROLE_KEY, AgentAutonomyController.prototype.set);
    expect(papel).toBe('maintainer');
  });
});

describe('SetAgentAutonomyDto — aceita a curinga do auto mode', () => {
  function erros(dto: object) {
    return validateSync(plainToInstance(SetAgentAutonomyDto, dto) as object);
  }

  it('"*" é um actionType válido', () => {
    expect(
      erros({ agentId: 'dev-api', actionType: '*', mode: 'auto_approve' }),
    ).toHaveLength(0);
  });

  it('um tipo real continua válido (não regrediu)', () => {
    expect(
      erros({ agentId: 'dev-api', actionType: 'terminal', mode: 'auto_approve' }),
    ).toHaveLength(0);
  });

  it('string qualquer fora da lista é recusada — a curinga não virou "aceita tudo"', () => {
    expect(
      erros({ agentId: 'dev-api', actionType: '**', mode: 'auto_approve' }),
    ).not.toHaveLength(0);
  });
});
