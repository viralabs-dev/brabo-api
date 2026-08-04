import { Injectable } from '@nestjs/common';
import { TokenUsageRepository } from '../../ports/token-usage-repository.port';
import { UserCredentialRepository } from '../../ports/user-credential-repository.port';
import { WorkspaceRepository } from '../../ports/workspace-repository.port';

export interface CredentialSpendPorMes {
  mes: string;
  costMicros: number;
  chamadas: number;
}

export interface CredentialSpendPorProvider {
  provider: string;
  /** A credencial existe hoje? Gasto de chave já REMOVIDA continua no histórico. */
  temCredencial: boolean;
  costMicros: number;
  inputTokens: number;
  outputTokens: number;
  chamadas: number;
  /** Quanto veio de AGENTE e quanto veio de gente no chat. */
  costMicrosAgentes: number;
  costMicrosPessoas: number;
  porMes: CredentialSpendPorMes[];
}

export interface CredentialSpend {
  workspaceId: string;
  /** Dono das chaves — quem banca os agentes deste workspace (RN-058). */
  ownerId: string;
  meses: number;
  totalMicros: number;
  porProvider: CredentialSpendPorProvider[];
}

/**
 * O relatório de gasto das chaves do OWNER.
 *
 * Nasceu junto com a RN-058: desde que o agente passou a gastar a credencial
 * do owner do workspace, quem paga a conta precisa ver a conta — e não havia
 * nenhuma tela que respondesse "quanto saiu da minha chave da OpenRouter este
 * mês".
 *
 * Duas separações que o número sozinho esconderia:
 *
 * - **por provider**, porque é essa a unidade da credencial (uma chave por
 *   provider). Somar tudo daria um número que não bate com fatura nenhuma;
 * - **agente vs pessoa**, porque as duas coisas saem da MESMA chave desde a
 *   RN-058, e a pergunta "meus agentes estão caros?" é diferente de "eu estou
 *   usando muito o chat?".
 */
@Injectable()
export class GetCredentialSpendUseCase {
  constructor(
    private readonly tokenUsage: TokenUsageRepository,
    private readonly credentials: UserCredentialRepository,
    private readonly workspaces: WorkspaceRepository,
  ) {}

  async execute(workspaceId: string, meses = 6): Promise<CredentialSpend> {
    const workspace = await this.workspaces.findById(workspaceId);
    const ownerId = workspace?.createdBy ?? '';

    const [linhas, credenciais] = await Promise.all([
      this.tokenUsage.sumByWorkspaceGroupedByProviderAndMonth(
        workspaceId,
        meses,
      ),
      ownerId
        ? this.credentials.listMetadataForUser(ownerId)
        : Promise.resolve([]),
    ]);

    // `Set<string>`: o relatório fala de `token_usage.provider`, que é texto
    // no banco. Estreitar para o union de credencial aqui só serviria para
    // esconder um provider que gastou e cuja chave já não existe.
    const cadastrados = new Set<string>(credenciais.map((c) => c.provider));
    const porProvider = new Map<string, CredentialSpendPorProvider>();

    for (const linha of linhas) {
      const atual = porProvider.get(linha.provider) ?? {
        provider: linha.provider,
        temCredencial: cadastrados.has(linha.provider),
        costMicros: 0,
        inputTokens: 0,
        outputTokens: 0,
        chamadas: 0,
        costMicrosAgentes: 0,
        costMicrosPessoas: 0,
        porMes: [] as CredentialSpendPorMes[],
      };

      atual.costMicros += linha.costMicros;
      atual.inputTokens += linha.inputTokens;
      atual.outputTokens += linha.outputTokens;
      atual.chamadas += linha.chamadas;
      if (linha.actorKind === 'agent') {
        atual.costMicrosAgentes += linha.costMicros;
      } else {
        atual.costMicrosPessoas += linha.costMicros;
      }

      const mes = atual.porMes.find((m) => m.mes === linha.mes);
      if (mes) {
        mes.costMicros += linha.costMicros;
        mes.chamadas += linha.chamadas;
      } else {
        atual.porMes.push({
          mes: linha.mes,
          costMicros: linha.costMicros,
          chamadas: linha.chamadas,
        });
      }

      porProvider.set(linha.provider, atual);
    }

    const lista = [...porProvider.values()].sort(
      (a, b) => b.costMicros - a.costMicros,
    );
    for (const p of lista) {
      p.porMes.sort((a, b) => b.mes.localeCompare(a.mes));
    }

    return {
      workspaceId,
      ownerId,
      meses,
      totalMicros: lista.reduce((n, p) => n + p.costMicros, 0),
      porProvider: lista,
    };
  }
}
