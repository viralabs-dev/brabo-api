import { describe, it, expect, afterEach } from 'vitest';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import {
  CABECALHO_SERVICE_TOKEN,
  EngineServiceGuard,
} from '../../src/interfaces/http/auth/engine-service.guard';

/**
 * O guard das rotas `/internal/*` durante a rotação do `BRABO_SERVICE_TOKEN`
 * (`docs/runbook.md`, RN-597). `service-token.spec.ts` prova as funções; este
 * prova que a PORTA de entrada do engine usa a que aceita o anterior — um
 * guard que comparasse direto contra `tokenDeServicoAtual()` passaria em todo
 * teste de caminho feliz e quebraria só no meio de um rollout.
 */

// Sem entropia de propósito (Gitleaks recusa valor de alta entropia atribuído
// a variável de segredo — mesma nota de `service-token.spec.ts`).
const VELHO = 'token-velho-de-teste-nao-e-segredo';
const NOVO = 'token-novo-de-teste-nao-e-segredo';

function contexto(cabecalho?: string | string[]): ExecutionContext {
  const headers: Record<string, string | string[]> = {};
  if (cabecalho !== undefined) headers[CABECALHO_SERVICE_TOKEN] = cabecalho;
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  } as unknown as ExecutionContext;
}

describe('EngineServiceGuard na rotação do BRABO_SERVICE_TOKEN', () => {
  const nodeEnvOriginal = process.env.NODE_ENV;
  const guard = new EngineServiceGuard();

  afterEach(() => {
    delete process.env.BRABO_SERVICE_TOKEN;
    delete process.env.BRABO_SERVICE_TOKEN_PREVIOUS;
    if (nodeEnvOriginal === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = nodeEnvOriginal;
  });

  it('caminho feliz, em rotação: engine velho e engine novo entram', () => {
    process.env.NODE_ENV = 'production';
    process.env.BRABO_SERVICE_TOKEN = NOVO;
    process.env.BRABO_SERVICE_TOKEN_PREVIOUS = VELHO;

    expect(guard.canActivate(contexto(NOVO))).toBe(true);
    expect(guard.canActivate(contexto(VELHO))).toBe(true);
  });

  it('terminada a rotação, o engine que ficou no token velho recebe 403', () => {
    process.env.NODE_ENV = 'production';
    process.env.BRABO_SERVICE_TOKEN = NOVO;

    expect(() => guard.canActivate(contexto(VELHO))).toThrow(
      ForbiddenException,
    );
  });

  it('sem cabeçalho, 403 mesmo em rotação', () => {
    process.env.NODE_ENV = 'production';
    process.env.BRABO_SERVICE_TOKEN = NOVO;
    process.env.BRABO_SERVICE_TOKEN_PREVIOUS = VELHO;

    expect(() => guard.canActivate(contexto())).toThrow(ForbiddenException);
  });
});
