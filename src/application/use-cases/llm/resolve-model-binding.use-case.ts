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
    return resolveBinding(candidates);
  }
}
