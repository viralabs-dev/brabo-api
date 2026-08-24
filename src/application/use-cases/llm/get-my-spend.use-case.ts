import { Injectable } from '@nestjs/common';
import {
  TokenUsageRepository,
  type SpendScopeDeAtor,
} from '../../ports/token-usage-repository.port';
import {
  comoLinhas,
  densificarPorDia,
  somarTotais,
  type SpendLinha,
  type SpendPorDia,
} from './spend-report';

export interface MySpend {
  projectId: string;
  dias: number;
  /** O ator cujas linhas — e só as dele — compõem este relatório. */
  actorId: string;
  totalMicros: number;
  inputTokens: number;
  outputTokens: number;
  chamadas: number;
  porSessao: SpendLinha[];
  porDia: SpendPorDia[];
}

/**
 * O que EU consumi neste projeto — a audiência do membro (FASE 22, RN-101).
 *
 * A colisão que este caso de uso resolve: pela [RN-058] a chave que roda é a do
 * owner, e pela [RN-060] a fatura dessa chave é dele e só dele. Um membro
 * querendo saber "quanto eu gastei" estaria pedindo uma fatia de conta alheia.
 *
 * A saída é as duas perguntas nunca serem a mesma:
 *
 * - a do owner é por CREDENCIAL (provider, chave, fatura) e continua exigindo
 *   `owner`;
 * - a do membro é por ATOR, em tokens e custo estimado, e **não quebra por
 *   provider nem por credencial**. Ela não diz de que chave saiu, porque isso
 *   não é assunto dele.
 *
 * O ator NÃO é parâmetro: vem do usuário autenticado, e o caso de uso não
 * expõe forma de perguntar por outro. É o que faz "membro não vê linha de
 * outro ator" ser uma propriedade da assinatura, e não uma checagem que alguém
 * pode esquecer de chamar.
 *
 * **O ADR 0076 devolveu o eixo de provider ao relatório do owner, e nada aqui
 * mudou** — de propósito. Antes, o membro não alcançava o eixo porque ele não
 * existia em lugar nenhum; agora ele existe, e o que o mantém fora daqui são
 * duas barreiras independentes: a rota não tem parâmetro de dimensão (o
 * `execute` recebe projeto, usuário e janela, e mais nada), e o escopo com
 * `actor` não TIPA com `'provider'` no port (RN-187). A primeira já bastava; a
 * segunda existe para que ela continue bastando depois da próxima mudança.
 *
 * Agente não entra. `token_usage` registra QUEM gastou, não quem mandou
 * gastar — atribuir o agente a quem o iniciou seria inventar um dado que a
 * tabela não tem.
 */
@Injectable()
export class GetMySpendUseCase {
  constructor(private readonly tokenUsage: TokenUsageRepository) {}

  async execute(
    projectId: string,
    userId: string,
    dias: number,
    agora = new Date(),
  ): Promise<MySpend> {
    // Escopo DE ATOR. Ele restringe as linhas (RN-101) e, desde o ADR 0076,
    // também restringe as DIMENSÕES: com `actor` presente, o port só aceita
    // `SpendDimensionDoAtor`, e `sumGroupedBy('provider', escopo)` daqui não
    // compila (RN-187). É por isso que o tipo está escrito, e não inferido.
    const escopo: SpendScopeDeAtor = {
      projectId,
      actor: { kind: 'user' as const, id: userId },
      dias,
    };

    const [porSessao, porDia] = await Promise.all([
      this.tokenUsage.sumGroupedBy('session', escopo),
      this.tokenUsage.sumGroupedBy('day', escopo),
    ]);

    const totais = somarTotais(porSessao);

    return {
      projectId,
      dias,
      actorId: userId,
      totalMicros: totais.costMicros,
      inputTokens: totais.inputTokens,
      outputTokens: totais.outputTokens,
      chamadas: totais.chamadas,
      porSessao: comoLinhas(porSessao),
      porDia: densificarPorDia(porDia, dias, agora),
    };
  }
}
