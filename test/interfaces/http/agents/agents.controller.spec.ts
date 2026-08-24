import { describe, it, expect } from 'vitest';
import { Reflector } from '@nestjs/core';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { AgentsController } from '../../../../src/interfaces/http/agents/agents.controller';
import { REQUIRED_ROLE_KEY } from '../../../../src/interfaces/http/iam/require-role.decorator';
import { RequestManualHandoffDto } from '../../../../src/interfaces/http/agents/dto/request-manual-handoff.dto';

/**
 * Handoff manual a agente à escolha (ADR 0109/RN-440): `POST
 * .../sessions/:sessionId/handoffs` é uma rota que qualquer usuário com
 * papel `developer` pode chamar — o mesmo papel que `POST
 * .../handoffs/:handoffId/accept` já exige (RN-136, quem CONVERSA nesta
 * tela). `RolesGuard` (roles.guard.spec.ts) prova a matriz em geral;
 * `route-surface.spec.ts` prova o mesmo fato em runtime contra
 * `docs/security-surface.md` — este é o companheiro rápido, sem subir o
 * `AppModule`.
 */
describe('AgentsController — POST handoffs (handoff manual, ADR 0109)', () => {
  const reflector = new Reflector();

  it('exige developer', () => {
    const papel = reflector.get(
      REQUIRED_ROLE_KEY,
      AgentsController.prototype.requestManual,
    );
    expect(papel).toBe('developer');
  });

  it('o accept continua exigindo developer (não regrediu)', () => {
    const papel = reflector.get(
      REQUIRED_ROLE_KEY,
      AgentsController.prototype.accept,
    );
    expect(papel).toBe('developer');
  });
});

describe('RequestManualHandoffDto', () => {
  function erros(dto: object) {
    return validateSync(
      plainToInstance(RequestManualHandoffDto, dto) as object,
    );
  }

  it('toAgent válido passa', () => {
    expect(erros({ toAgent: 'staff' })).toHaveLength(0);
  });

  it('toAgent vazio é recusado (a validação de catálogo é do use case, não do DTO)', () => {
    expect(erros({ toAgent: '' })).not.toHaveLength(0);
  });

  it('sem toAgent é recusado', () => {
    expect(erros({})).not.toHaveLength(0);
  });
});
