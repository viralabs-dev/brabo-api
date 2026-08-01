import { Injectable } from '@nestjs/common';
import { ModelBindingRepository } from '../../ports/model-binding-repository.port';
import { ProjectRepository } from '../../ports/project-repository.port';
import {
  resolveBinding,
  type ResolvedBinding,
} from '../../../domain/llm/binding-resolver';
import type { ModelBindingScope } from '../../../domain/llm/model-binding-scope';

export interface ResolveModelBindingInput {
  projectId: string;
  sessionId?: string;
  agentId?: string;
  /**
   * `true` quando quem vai usar o modelo roda ToolLoop (Fase 9c). A cascata
   * então PULA candidatos sem tool calling em vez de pousar num modelo
   * chat-only e quebrar depois — ver `binding-resolver.ts`.
   */
  exigeToolCalling?: boolean;
}

@Injectable()
export class ResolveModelBindingUseCase {
  constructor(
    private readonly bindings: ModelBindingRepository,
    private readonly projects: ProjectRepository,
  ) {}

  async execute(
    input: ResolveModelBindingInput,
  ): Promise<ResolvedBinding | null> {
    const project = await this.projects.findById(input.projectId);
    if (!project) return null;

    const scopeIds: Partial<Record<ModelBindingScope, string>> = {
      workspace: project.workspaceId,
      project: input.projectId,
    };
    if (input.agentId) scopeIds.agent = input.agentId;
    if (input.sessionId) scopeIds.session = input.sessionId;

    const candidates = await this.bindings.findCandidates(scopeIds);
    return resolveBinding(candidates, input.exigeToolCalling ?? false);
  }
}
