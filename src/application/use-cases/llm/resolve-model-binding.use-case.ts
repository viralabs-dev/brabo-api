import { Injectable } from '@nestjs/common';
import { ModelBindingRepository } from '../../ports/model-binding-repository.port';
import { ProjectRepository } from '../../ports/project-repository.port';
import {
  AGENTE_DE_START,
  herdarModeloDeStart,
  resolveBinding,
  type ResolvedBinding,
} from '../../../domain/llm/binding-resolver';
import {
  chaveDeAgente,
  chaveDeArea,
} from '../../../domain/llm/binding-scope-id';
import { areaDo } from '../../../domain/agents/agent-areas';
import type { ModelBindingScope } from '../../../domain/llm/model-binding-scope';

export interface ResolveModelBindingInput {
  projectId: string;
  sessionId?: string;
  agentId?: string;
  /**
   * A área a consultar, quando a pergunta é sobre a ÁREA e não sobre um agente
   * dela ("qual modelo a área de QA usa"). Com `agentId`, a área sai sozinha do
   * catálogo e este campo não é necessário.
   */
  areaKey?: string;
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
    if (input.agentId) {
      scopeIds.agent = chaveDeAgente(input.projectId, input.agentId);
    }

    // A área do agente sai do CATÁLOGO (`agent-areas.ts`), não da tabela: é a
    // mesma fonte que decide endereçamento de handoff, e ela cobre a área
    // dinâmica de `dev` pelo predicado `ehDevDeModulo` — consultar
    // `agent_areas` aqui acrescentaria um round-trip por turno de agente para
    // responder o que a lista já responde sem banco.
    const areaKey =
      input.areaKey ?? (input.agentId ? areaDo(input.agentId)?.key : undefined);
    if (areaKey) scopeIds.area = chaveDeArea(input.projectId, areaKey);

    if (input.sessionId) scopeIds.session = input.sessionId;

    const exigeToolCalling = input.exigeToolCalling ?? false;
    const candidates = await this.bindings.findCandidates(scopeIds);
    const resolvido = resolveBinding(candidates, exigeToolCalling);

    // Quem já É o Criativo não herda de si mesmo — e quem tem binding de agente
    // próprio nem chega aqui, porque a cascata não pousou em `workspace`.
    if (input.agentId === AGENTE_DE_START) return resolvido;

    // Só busca o binding do Criativo quando ele pode importar: a cascata caiu
    // no default global do workspace, isto é, ninguém decidiu nada para este
    // projeto (ver `herdarModeloDeStart`).
    if (resolvido?.origin !== 'workspace') return resolvido;

    // O Criativo DESTE projeto: desde o ADR 0064 o binding de agente é por
    // projeto, e buscar o slug puro não acharia mais nada.
    const [doCriativo] = await this.bindings.findCandidates({
      agent: chaveDeAgente(input.projectId, AGENTE_DE_START),
    });

    return herdarModeloDeStart(resolvido, doCriativo ?? null, exigeToolCalling);
  }
}
