import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { tokenDeServicoConfere } from '../../../infrastructure/security/service-token';

/** O cabeçalho que o engine manda. Ver EngineApiClient no lado Elixir. */
export const CABECALHO_SERVICE_TOKEN = 'x-brabo-service-token';

/**
 * Autentica o tráfego interno do engine (Fase 7a, item 4).
 *
 * ## O que mudou no corte
 *
 * Antes: o `JwtAuthGuard` validava um token client-credentials do Keycloak e
 * este guard só conferia de QUEM era o token, pelo claim `azp` (via
 * `request.clientId`). O token first-party não tem `azp` — e sem tratar isso o
 * corte fecharia as 26 rotas `/internal/*` de uma vez.
 *
 * Agora: as rotas saem do JWT (`@ServiceRoute()`) e a autenticação é um
 * segredo compartilhado em cabeçalho próprio. Não é rebaixamento — o que o
 * JWT dava aqui era uma assinatura verificável de um emissor que existia só
 * para isso. Removido o emissor, um segredo comparado em tempo constante
 * entrega a mesma garantia com uma peça a menos.
 *
 * ## Por que a classe manteve o nome
 *
 * `route-surface.spec.ts` classifica a rota como `engine-service` procurando
 * esta classe pelo nome nos metadados de guard. Renomear reclassificaria as 26
 * rotas e exigiria reescrever a tabela de `docs/security-surface.md` — churn
 * que esconderia, no meio do diff, qualquer mudança real de exposição.
 *
 * ## Cabeçalho próprio, e não `Authorization: Bearer`
 *
 * Numa rota `Authorization` já significa "JWT de usuário" no resto da api.
 * Reusar o cabeçalho para outro mecanismo criaria uma ambiguidade que só se
 * resolve lendo o guard — e é o tipo de coisa que leva alguém a mandar o
 * token de serviço para uma rota de usuário.
 */
@Injectable()
export class EngineServiceGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const cabecalho = request.headers[CABECALHO_SERVICE_TOKEN];
    const apresentado = Array.isArray(cabecalho) ? cabecalho[0] : cabecalho;

    if (!apresentado || !tokenDeServicoConfere(apresentado)) {
      throw new ForbiddenException('Chamada restrita ao serviço engine');
    }
    return true;
  }
}
