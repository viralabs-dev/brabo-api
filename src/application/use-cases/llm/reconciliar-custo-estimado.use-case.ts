import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { TokenUsageRepository } from '../../ports/token-usage-repository.port';
import { UserCredentialRepository } from '../../ports/user-credential-repository.port';
import { EncryptionService } from '../../ports/encryption.port';
import { ResolveCredentialOwnerUseCase } from './resolve-credential-owner.use-case';
import { getJson } from '../../../infrastructure/llm/http-stream';
import { OPENROUTER_BASE_URL } from '../../../infrastructure/llm/openrouter-provider';
import { precoImplicitoPorMilhao } from '../../../domain/llm/tool-router';

/** Depois disto a estimativa vira definitiva: o `/generation` não responde mais. */
const JANELA_MS = 24 * 3600_000;
const LOTE = 50;

/**
 * Troca a ESTIMATIVA de um stream abortado pelo orçamento de raciocínio pelo
 * custo REAL de `GET /generation?id=` (ADR 0224, RN-915). O endpoint só
 * responde uns 5 minutos depois (antes, 404), então o job é periódico e
 * idempotente: só toca linha ainda marcada, e só com 200. Qualquer outra
 * resposta deixa a linha como está para a próxima passada.
 *
 * Não corrige o `spentMicros` de budget/área: a diferença é de centavos e o
 * orçamento já foi checado com a estimativa (declarado no ADR 0224).
 */
@Injectable()
export class ReconciliarCustoEstimadoUseCase
  implements OnModuleInit, OnModuleDestroy
{
  private readonly log = new Logger(ReconciliarCustoEstimadoUseCase.name);
  private timer?: NodeJS.Timeout;
  private rodando = false;

  constructor(
    private readonly usage: TokenUsageRepository,
    private readonly credentials: UserCredentialRepository,
    private readonly encryption: EncryptionService,
    private readonly resolveOwner: ResolveCredentialOwnerUseCase,
  ) {}

  onModuleInit(): void {
    // 0 desliga (testes); o default de 5 min casa com a latência do endpoint.
    const ms = Number(process.env.CUSTO_RECONCILIACAO_INTERVAL_MS ?? 300_000);
    if (!(ms > 0)) return;
    this.timer = setInterval(() => void this.execute(), ms);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Devolve quantas linhas foram trocadas. */
  async execute(agora: Date = new Date()): Promise<number> {
    if (this.rodando) return 0;
    this.rodando = true;
    let trocadas = 0;
    try {
      const linhas = await this.usage.listarACorrigir(
        new Date(agora.getTime() - JANELA_MS),
        LOTE,
      );
      for (const l of linhas) {
        if (l.provider !== 'openrouter') continue;
        try {
          const dono = await this.resolveOwner.execute(l.projectId);
          const secret = await this.credentials.findSecretByUserAndProvider(
            dono,
            'openrouter',
          );
          if (!secret) continue;
          const { status, body } = await getJson({
            url: `${OPENROUTER_BASE_URL}/generation?id=${encodeURIComponent(l.generationId)}`,
            headers: {
              Authorization: `Bearer ${this.encryption.decrypt(secret)}`,
            },
            timeoutMs: 15_000,
            timeoutEnvName: 'LLM_TIMEOUT_MS',
            provider: 'openrouter',
          });
          if (status !== 200) continue; // 404 = ainda não disponível
          const custo = (
            JSON.parse(body) as { data?: { total_cost?: unknown } }
          ).data?.total_cost;
          if (typeof custo !== 'number' || !(custo >= 0)) continue;
          const micros = Math.round(custo * 1_000_000);
          const preco = precoImplicitoPorMilhao(
            micros,
            l.inputTokens + l.outputTokens,
          );
          if (await this.usage.aplicarCustoReal(l.id, micros, preco)) {
            trocadas++;
          }
        } catch (error) {
          this.log.warn(
            `reconciliação de ${l.generationId} adiada: ${(error as Error).message}`,
          );
        }
      }
    } finally {
      this.rodando = false;
    }
    return trocadas;
  }
}
