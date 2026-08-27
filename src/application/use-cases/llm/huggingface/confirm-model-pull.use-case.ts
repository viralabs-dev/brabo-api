import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ModelPullRequestRepository } from '../../../ports/model-pull-request-repository.port';
import { ModelRepository } from '../../../ports/model-repository.port';
import { WorkspaceModelRepository } from '../../../ports/workspace-model-repository.port';
import { OllamaProvider } from '../../../../infrastructure/llm/ollama-provider';
import { LLMProviderError } from '../../../../domain/llm/llm-provider-errors';
import type { ModelPullRequest } from '../../../../domain/huggingface/model-pull-request.entity';

export interface ConfirmModelPullInput {
  id: string;
  workspaceId: string;
  /** Quem confirma — vira `curatedBy` da ativação automática no catálogo. */
  confirmedBy: string;
}

/**
 * Segunda etapa do pull — a confirmação explícita que o produto exige antes
 * de qualquer download rodar de verdade. Move `pending_confirmation` →
 * `confirmed` → `pulling`, chama `OllamaProvider.pullModel`, e SÓ em sucesso
 * ativa o modelo no catálogo (`upsertByProviderAndName` + `setActive`) —
 * espelhando a regra permanente do catálogo: "não ativar modelo descoberto
 * automaticamente" (ADR 0042) não se aplica aqui porque a ativação não é
 * automática nenhuma — é a CONSEQUÊNCIA de um humano ter pedido este modelo
 * específico duas vezes (pedido + confirmação).
 *
 * ## Por que este método aguarda o pull INTEIRO antes de responder
 *
 * A api não tem um runner de fila próprio (Oban é do engine, em Elixir, e
 * não há canal de comando síncrono da api para lá pensado para isto). Sem um
 * mecanismo de background job na própria api, "disparar e não esperar" aqui
 * significaria perder a exceção não tratada assim que a função que a chamou
 * retornasse — o `markFailed` do catch abaixo nunca rodaria. A rota de status
 * (`GET .../pull-requests/:id`) segue existindo mesmo com a confirmação
 * síncrona: ela é para quem prefere não segurar a conexão HTTP aberta
 * (proxies e gateways têm timeout mais curto que um download de alguns GB) —
 * o pull continua rodando no processo da api independente disso. Corte
 * declarado, candidato a ADR: uma fila de verdade na api é o próximo passo se
 * o volume justificar.
 */
@Injectable()
export class ConfirmModelPullUseCase {
  constructor(
    private readonly pullRequests: ModelPullRequestRepository,
    private readonly models: ModelRepository,
    private readonly workspaceModels: WorkspaceModelRepository,
    private readonly ollama: OllamaProvider,
  ) {}

  async execute(input: ConfirmModelPullInput): Promise<ModelPullRequest> {
    const pedido = await this.pullRequests.findByIdInWorkspace(
      input.id,
      input.workspaceId,
    );
    if (!pedido) {
      throw new NotFoundException('Pedido de pull não encontrado');
    }
    if (pedido.status !== 'pending_confirmation') {
      throw new ConflictException(
        `Pedido já está em "${pedido.status}" — só um pedido em ` +
          '"pending_confirmation" pode ser confirmado',
      );
    }

    await this.pullRequests.markConfirmed(pedido.id);
    await this.pullRequests.markPulling(pedido.id);

    try {
      await this.ollama.pullModel(pedido.repoId);
    } catch (error) {
      const motivo = descreverFalha(error);
      return this.pullRequests.markFailed(pedido.id, motivo);
    }

    const modelo = await this.models.upsertByProviderAndName({
      provider: 'ollama',
      name: `hf.co/${pedido.repoId}`,
      displayName: pedido.repoId,
      inputPricePerMillionMicros: 0,
      outputPricePerMillionMicros: 0,
      manualPricing: false,
    });

    await this.workspaceModels.setActive({
      workspaceId: input.workspaceId,
      modelIds: [modelo.id],
      isActive: true,
      curatedBy: input.confirmedBy,
    });

    return this.pullRequests.markActive(pedido.id);
  }
}

/**
 * Origem da falha no vocabulário do ADR 0020 (infra | modelo | código |
 * política) — prefixada na mensagem porque `failed_reason` é `text` livre,
 * sem coluna própria para a origem, e a régua do projeto é nunca diagnosticar
 * por eliminação depois.
 */
function descreverFalha(error: unknown): string {
  if (error instanceof LLMProviderError) {
    const origem =
      error.code === 'connection' || error.code === 'timeout'
        ? 'infra'
        : 'modelo';
    return `[${origem}] ${error.message}`;
  }
  return `[código] ${error instanceof Error ? error.message : String(error)}`;
}
