import { Injectable } from '@nestjs/common';
import type { LLMProviderName } from '@brabo/shared';
import { UserCredentialRepository } from '../../ports/user-credential-repository.port';
import { WorkspaceRepository } from '../../ports/workspace-repository.port';
import { LLM_PROVIDER_NAMES_COM_CREDENCIAL } from '../../../domain/llm/llm-provider-names';

/**
 * Quais providers de LLM têm chave do TITULAR do workspace (RN-926) — a mesma
 * pessoa cuja credencial os agentes gastam (RN-058, `workspaces.created_by`).
 * Só os NOMES: nunca id, data nem segredo. `ollama` não tem credencial e fica
 * de fora; token de git (`github`/`gitlab`) também.
 */
@Injectable()
export class ListCredentialedProvidersUseCase {
  constructor(
    private readonly credentials: UserCredentialRepository,
    private readonly workspaces: WorkspaceRepository,
  ) {}

  async execute(
    workspaceId: string,
  ): Promise<{ providers: LLMProviderName[] }> {
    const workspace = await this.workspaces.findById(workspaceId);
    if (!workspace) return { providers: [] };
    const tem = new Set<string>(
      (await this.credentials.listMetadataForUser(workspace.createdBy)).map(
        (c) => c.provider,
      ),
    );
    // Ordem da lista canônica: estável, sem depender do banco.
    return {
      providers: LLM_PROVIDER_NAMES_COM_CREDENCIAL.filter((p) => tem.has(p)),
    };
  }
}
