import { Injectable } from '@nestjs/common';
import {
  TokenUsageRepository,
  type SpendScopeAmplo,
} from '../../ports/token-usage-repository.port';
import { WorkspaceRepository } from '../../ports/workspace-repository.port';
import {
  comoLinhas,
  densificarPorDia,
  somarTotais,
  type SpendLinha,
  type SpendPorDia,
} from './spend-report';

export interface WorkspaceSpendReport {
  workspaceId: string;
  /** Dono das chaves — quem banca os agentes deste workspace (RN-058). */
  ownerId: string;
  dias: number;
  totalMicros: number;
  inputTokens: number;
  outputTokens: number;
  chamadas: number;
  porModelo: SpendLinha[];
  /**
   * Por PROVIDER — o eixo que o ADR 0076 reabriu (RN-186). Fala de CREDENCIAL,
   * e por isso só existe aqui, no relatório que já exigia `owner` (RN-060).
   */
  porProvider: SpendLinha[];
  porProjeto: SpendLinha[];
  porAtor: SpendLinha[];
  /**
   * As linhas de PESSOA (`actor_kind = 'user'`). O handoff chama este bloco de
   * "Por owner" porque, pela RN-058, é a chave do owner que todas elas gastam —
   * quem é o dono está em `ownerId`, não no `actorKind` de cada linha.
   */
  porOwner: SpendLinha[];
  /** As linhas de AGENTE (`actor_kind = 'agent'`). */
  porAgente: SpendLinha[];
  porDia: SpendPorDia[];
}

/**
 * O gasto do workspace INTEIRO — a audiência do owner (FASE 22, RN-101).
 *
 * Responde as perguntas que `token_usage` sempre soube responder e nenhuma
 * agregação fazia: em que MODELO o dinheiro foi, em que PROJETO, por conta de
 * QUEM (agente ou pessoa) e em que RITMO.
 *
 * **Desde o ADR 0076 ele TEM o eixo de PROVIDER** (RN-186), revisando o ADR
 * 0063. O argumento do 0063 não caiu — quebrar por provider é quebrar por
 * credencial —, e é justamente por ele que o eixo mora aqui e em nenhum outro
 * lugar: este relatório já exigia `owner` na rota pela [RN-060], a mesma régua
 * de `GetCredentialSpendUseCase`. O que a fatura por credencial responde e este
 * não é a série por MÊS e o vínculo com a chave que existe hoje; o que este
 * responde e ela não é o gasto por provider DENTRO da janela deslizante, ao
 * lado de modelo, projeto e ator. A visão do membro não alcança o eixo — e
 * agora por TIPO, não por ausência de argumento (RN-187).
 *
 * Uma nota sobre a dimensão `model`: dois providers servindo o MESMO nome de
 * modelo continuam caindo na mesma linha. Isso NÃO mudou com o eixo novo —
 * quem quiser a quebra por provider tem a lista própria, e cruzar as duas
 * dimensões numa só multiplicaria as linhas do ranking sem responder pergunta
 * nenhuma que as duas listas separadas já não respondam.
 *
 * `porOwner` e `porAgente` são PARTIÇÃO de `porAtor`, não duas consultas novas
 * (RN-188): `actorKind` já vem na linha desde a FASE 22, e o ADR 0063 mediu que
 * o custo destas consultas cresce com o tamanho de `token_usage`, não com o do
 * pedido — pagar duas varreduras a mais para separar o que já está separado na
 * memória seria caro pelo motivo errado.
 */
@Injectable()
export class GetWorkspaceSpendReportUseCase {
  constructor(
    private readonly tokenUsage: TokenUsageRepository,
    private readonly workspaces: WorkspaceRepository,
  ) {}

  async execute(
    workspaceId: string,
    dias: number,
    agora = new Date(),
  ): Promise<WorkspaceSpendReport> {
    // Escopo AMPLO — sem ator. É esta ausência que abre o eixo de provider, e
    // é ela que o tipo do port cobra (ADR 0076, RN-187).
    const escopo: SpendScopeAmplo = { workspaceId, dias };

    const [workspace, porModelo, porProvider, porProjeto, porAtor, porDia] =
      await Promise.all([
        this.workspaces.findById(workspaceId),
        this.tokenUsage.sumGroupedBy('model', escopo),
        this.tokenUsage.sumGroupedBy('provider', escopo),
        this.tokenUsage.sumGroupedBy('project', escopo),
        this.tokenUsage.sumGroupedBy('actor', escopo),
        this.tokenUsage.sumGroupedBy('day', escopo),
      ]);

    // O total sai do recorte por ATOR e não da soma das quatro: qualquer um dos
    // quatro cobre as mesmas linhas, e somar mais de um daria o gasto contado
    // N vezes.
    const totais = somarTotais(porAtor);

    return {
      workspaceId,
      ownerId: workspace?.createdBy ?? '',
      dias,
      totalMicros: totais.costMicros,
      inputTokens: totais.inputTokens,
      outputTokens: totais.outputTokens,
      chamadas: totais.chamadas,
      porModelo: comoLinhas(porModelo),
      porProvider: comoLinhas(porProvider),
      porProjeto: comoLinhas(porProjeto),
      porAtor: comoLinhas(porAtor),
      // A partição preserva a ordem por custo que o SQL já deu. `actor_kind`
      // que não seja pessoa nem agente (hoje, `system`) não entra em nenhum dos
      // dois blocos de propósito: ele continua visível em `porAtor` e no total,
      // e inventar um terceiro bloco para ele diria que o produto tem uma
      // audiência que ele não tem.
      porOwner: comoLinhas(porAtor.filter((l) => l.actorKind === 'user')),
      porAgente: comoLinhas(porAtor.filter((l) => l.actorKind === 'agent')),
      porDia: densificarPorDia(porDia, dias, agora),
    };
  }
}
