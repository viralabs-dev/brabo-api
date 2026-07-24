import { Injectable, Logger } from '@nestjs/common';
import { AgentInstructionRepository } from '../../ports/agent-instruction-repository.port';
import { AgentInstructionVersionRepository } from '../../ports/agent-instruction-version-repository.port';
import { ApiToEngineClient } from '../../ports/api-to-engine-client.port';

export interface ApplyInstructionInput {
  projectId: string;
  agent: string;
  content: string;
  createdBy?: string | null;
  sourceActionId?: string | null;
  sourceHypothesisId?: string | null;
  note?: string | null;
}

export interface ApplyInstructionResult {
  fromVersion: number;
  toVersion: number;
  versionId: string | null;
  changed: boolean;
  cacheInvalidated: boolean;
}

/**
 * Ponto ÚNICO por onde o conteúdo de instrução de um agente muda
 * (Fase 4b) — usado tanto pelo patch aprovado quanto pelo rollback.
 * Sempre: grava a versão no histórico append-only, atualiza o ponteiro
 * `agent_instructions` (que é o que o engine lê) e invalida o cache do
 * engine.
 *
 * **Backfill retroativo**: se o agente já tinha instrução mas nenhuma
 * versão no histórico (caso de tudo que foi semeado antes desta fase),
 * captura o conteúdo ATUAL como versão antes de sobrescrever — sem isso
 * o primeiro rollback não teria pra onde voltar.
 */
@Injectable()
export class ApplyInstructionVersionService {
  private readonly logger = new Logger(ApplyInstructionVersionService.name);

  constructor(
    private readonly instructions: AgentInstructionRepository,
    private readonly versions: AgentInstructionVersionRepository,
    private readonly engineClient: ApiToEngineClient,
  ) {}

  async apply(input: ApplyInstructionInput): Promise<ApplyInstructionResult> {
    const existing = await this.instructions.findByProjectAndAgent(
      input.projectId,
      input.agent,
    );
    const fromVersion = existing?.version ?? 0;

    if (existing) await this.backfillCurrentVersion(existing);

    const updated = await this.instructions.upsert({
      projectId: input.projectId,
      agent: input.agent,
      content: input.content,
    });

    // `upsert` não bumpa quando o conteúdo é idêntico — nada mudou, então
    // não gera versão nem invalida cache.
    if (existing && updated.version === existing.version) {
      return {
        fromVersion,
        toVersion: updated.version,
        versionId: null,
        changed: false,
        cacheInvalidated: false,
      };
    }

    const version = await this.versions.create({
      projectId: input.projectId,
      agent: input.agent,
      version: updated.version,
      content: updated.content,
      createdBy: input.createdBy ?? null,
      sourceActionId: input.sourceActionId ?? null,
      sourceHypothesisId: input.sourceHypothesisId ?? null,
      note: input.note ?? null,
    });

    const cacheInvalidated = await this.invalidateCache(
      input.projectId,
      input.agent,
    );

    return {
      fromVersion,
      toVersion: updated.version,
      versionId: version.id,
      changed: true,
      cacheInvalidated,
    };
  }

  private async backfillCurrentVersion(existing: {
    projectId: string;
    agent: string;
    version: number;
    content: string;
  }): Promise<void> {
    const history = await this.versions.listByAgent(
      existing.projectId,
      existing.agent,
    );
    if (history.length > 0) return;

    await this.versions.create({
      projectId: existing.projectId,
      agent: existing.agent,
      version: existing.version,
      content: existing.content,
      note: 'versão capturada retroativamente ao primeiro patch',
    });
  }

  // Best-effort: o conteúdo JÁ está no banco. Falhar aqui só significa
  // que os agentes vivos seguem com o cache velho até reiniciar — não é
  // motivo pra reprovar o patch.
  private async invalidateCache(
    projectId: string,
    agent: string,
  ): Promise<boolean> {
    try {
      await this.engineClient.invalidateInstructions(projectId, agent);
      return true;
    } catch (error) {
      this.logger.warn(
        `Falha ao invalidar o cache de instruções de ${agent} no engine: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return false;
    }
  }
}
