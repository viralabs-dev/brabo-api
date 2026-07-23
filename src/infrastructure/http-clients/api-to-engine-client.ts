import { Injectable } from '@nestjs/common';
import { ApiToEngineClient } from '../../application/ports/api-to-engine-client.port';
import type { TerminalExecutionResult } from '../../domain/actions/terminal-execution-result';

interface KeycloakTokenResponse {
  access_token: string;
  expires_in: number;
}

/**
 * Comando síncrono api -> engine: cria o processo de sessão
 * supervisionado quando a sessão transiciona pra 'active' — substitui o
 * antigo consumo de session.created via outbox do lado do engine.
 * Auth simétrica ao que já existe na direção engine->api (client
 * credentials do Keycloak, aqui com o client `api-service`).
 */
@Injectable()
export class HttpApiToEngineClient implements ApiToEngineClient {
  private cachedToken: { token: string; expiresAt: number } | null = null;

  async startSession(sessionId: string, projectId: string): Promise<void> {
    const token = await this.getToken();
    const engineUrl = process.env.ENGINE_URL ?? 'http://localhost:4000';

    const res = await fetch(`${engineUrl}/internal/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ sessionId, projectId }),
    });

    if (!res.ok) {
      throw new Error(
        `Falha ao criar sessão no engine: ${res.status} ${await res.text()}`,
      );
    }
  }

  async executeTerminalAction(
    projectId: string,
    sessionId: string,
    actionId: string,
    command: string,
  ): Promise<TerminalExecutionResult> {
    const token = await this.getToken();
    const engineUrl = process.env.ENGINE_URL ?? 'http://localhost:4000';

    const res = await fetch(`${engineUrl}/internal/actions/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ projectId, sessionId, actionId, command }),
    });

    if (!res.ok) {
      throw new Error(
        `Falha ao executar ação de terminal no engine: ${res.status} ${await res.text()}`,
      );
    }

    return (await res.json()) as TerminalExecutionResult;
  }

  private async getToken(): Promise<string> {
    if (this.cachedToken && Date.now() < this.cachedToken.expiresAt) {
      return this.cachedToken.token;
    }

    const keycloakUrl = process.env.KEYCLOAK_URL ?? 'http://localhost:8080';
    const realm = process.env.KEYCLOAK_REALM ?? 'brabo-dev';
    const clientId = process.env.API_KEYCLOAK_CLIENT_ID ?? 'api-service';
    const clientSecret =
      process.env.API_KEYCLOAK_CLIENT_SECRET ??
      'api-service-dev-secret-change-me';

    const response = await fetch(
      `${keycloakUrl}/realms/${realm}/protocol/openid-connect/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: clientId,
          client_secret: clientSecret,
        }),
      },
    );

    if (!response.ok) {
      throw new Error(
        `Falha ao buscar token client-credentials do Keycloak: ${response.status}`,
      );
    }

    const data = (await response.json()) as KeycloakTokenResponse;
    this.cachedToken = {
      token: data.access_token,
      expiresAt: Date.now() + (data.expires_in - 5) * 1000,
    };
    return data.access_token;
  }
}
