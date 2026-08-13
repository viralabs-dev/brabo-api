import type { LLMProviderName } from '@brabo/shared';
import type { TokenUsage } from '../../domain/llm/token-usage.entity';
import type { Actor } from '../../domain/sessions/session-event.entity';
import type { ModelBindingScope } from '../../domain/llm/model-binding-scope';

export interface RecordTokenUsageInput {
  sessionId: string;
  actor: Actor;
  provider: LLMProviderName;
  modelId: string | null;
  modelName: string;
  inputTokens: number;
  outputTokens: number;
  estimated: boolean;
  costMicros: number;
  /** O preço vigente no instante da chamada (Fase 9c, RN-044). */
  inputPricePerMillionMicros: number;
  outputPricePerMillionMicros: number;
  latencyMs: number;
  bindingOrigin: ModelBindingScope | null;
  upstreamProvider: string | null;
}

export abstract class TokenUsageRepository {
  abstract record(input: RecordTokenUsageInput): Promise<TokenUsage>;
  // Soma de costMicros pra uma sessão, filtrado por actor id (Fase 4b —
  // Psicólogo: custo da análise, somando ['psicologo','psicologo-leve'],
  // usado só pra exibição — o metering "de verdade" já é gravado
  // incondicionalmente por RecordLlmUsageUseCase pra QUALQUER agente).
  abstract sumBySessionAndActorIds(
    sessionId: string,
    actorIds: string[],
  ): Promise<number>;
  // Custo por AGENTE numa sessão (Fase 4a — painel do time). O dado sempre
  // esteve em token_usage, mas não havia agregação nem rota: o painel não
  // tinha como mostrar "tokens da sessão" por AgentCard, que é o que o
  // enunciado pede. Ver ADR 0021.
  abstract sumBySessionGroupedByActor(
    sessionId: string,
  ): Promise<AgentTokenUsage[]>;
  // Resumo do workspace pro dashboard de projetos (Fase de fidelidade da
  // UI): "M agentes" e o gasto do mês, numa query só. `actorKind = 'agent'`
  // é filtro OBRIGATÓRIO — sem ele um `user` mandando chat ou um `system`
  // registrando uso infla a contagem de agentes (RN-038).
  abstract summarizeForWorkspaceThisMonth(
    workspaceId: string,
  ): Promise<WorkspaceTokenUsageSummary>;

  /**
   * Custo por AGENTE no projeto, nos últimos 30 dias — a coluna "EST. MÊS" e o
   * card de custo do time que o mockup de Configurações desenha
   * (`design/SCREENS.md`). O dado sempre esteve em `token_usage`; faltava a
   * agregação por projeto, e a coluna vivia com um traço fixo.
   *
   * Janela DESLIZANTE de 30 dias, e não o mês corrente do
   * `summarizeForWorkspaceThisMonth`: o rótulo do desenho é "com base no
   * histórico de 30 dias", e no dia 1º um mês-calendário mostraria quase zero
   * — a estimativa despencaria por virada de página, não por mudança de uso.
   *
   * `actorKind = 'agent'` é filtro OBRIGATÓRIO pelo mesmo motivo do método
   * acima (RN-038): sem ele, um usuário conversando no chat entraria na conta
   * do agente cujo nome ele nem carrega.
   */
  abstract sumByProjectGroupedByAgentLast30Days(
    projectId: string,
  ): Promise<AgentTokenUsage[]>;

  /**
   * O que as CHAVES do owner gastaram no workspace, por provider e por mês.
   *
   * Existe porque a chave passou a ser a do owner do workspace (RN-058): os
   * agentes de todos os projetos gastam a credencial dele, e quem paga a conta
   * precisa ver a conta. Agrupa por `provider` porque é essa a unidade da
   * credencial — uma chave por provider, por pessoa.
   *
   * Sem filtro de `actor_kind`, ao contrário da RN-038: aqui a pergunta é
   * "quanto saiu da minha chave", e o chat do próprio owner também sai dela.
   * O `actorKind` vem na linha para o relatório separar as duas coisas sem
   * precisar de uma segunda consulta.
   */
  abstract sumByWorkspaceGroupedByProviderAndMonth(
    workspaceId: string,
    meses: number,
  ): Promise<CredentialSpendRow[]>;

  /**
   * As agregações que faltavam (FASE 22): por modelo, por projeto dentro do
   * workspace, por ator, por sessão e por dia.
   *
   * Um método só, parametrizado pela DIMENSÃO, porque as cinco perguntas
   * diferem em exatamente um `GROUP BY` — cinco cópias do mesmo join com uma
   * coluna trocada envelheceriam em direções diferentes.
   *
   * **`provider` não é uma dimensão daqui, e a ausência é o desenho**
   * ([RN-101](../../../../../docs/business-rules.md)). Quebrar gasto por
   * provider é quebrar por CREDENCIAL, e isso responde à fatura do owner —
   * que continua morando, exclusiva, em
   * `sumByWorkspaceGroupedByProviderAndMonth` e na rota com `@RequireRole('owner')`.
   * Deixar o eixo fora deste método é o que impede a visão do membro de
   * ganhá-lo por descuido: não existe argumento a passar.
   *
   * Sem filtro implícito de `actor_kind`: quem restringe é o `escopo`. A
   * RN-038 vale para os agregados que dizem "agentes"; este diz "gasto".
   */
  abstract sumGroupedBy(
    dimensao: SpendDimension,
    escopo: SpendScope,
  ): Promise<SpendBucket[]>;
}

/** Os cinco recortes do relatório de gasto. Nenhum deles é `provider`. */
export type SpendDimension = 'model' | 'project' | 'actor' | 'session' | 'day';

export interface SpendScope {
  /** Recorte largo: a fatura do owner. */
  workspaceId?: string;
  /** Recorte estreito: um projeto. */
  projectId?: string;
  /**
   * Quando presente, SÓ as linhas deste ator entram — é o que torna a visão do
   * membro dele e de mais ninguém (RN-101). Quem preenche é o caso de uso a
   * partir do usuário AUTENTICADO, nunca um parâmetro de rota.
   */
  actor?: Actor;
  /** Janela deslizante, em dias. */
  dias: number;
}

export interface SpendBucket {
  /** A chave do agrupamento: nome do modelo, id do projeto/sessão/ator, ou o dia `YYYY-MM-DD`. */
  chave: string;
  /** Nome legível quando a tabela tem um (projeto); `null` quando a chave já é o rótulo. */
  rotulo: string | null;
  /** Só a dimensão `actor` preenche — nas outras é `null`. */
  actorKind: string | null;
  costMicros: number;
  inputTokens: number;
  outputTokens: number;
  chamadas: number;
}

export interface CredentialSpendRow {
  provider: string;
  /** Primeiro dia do mês, em ISO — o eixo do relatório. */
  mes: string;
  actorKind: string;
  costMicros: number;
  inputTokens: number;
  outputTokens: number;
  chamadas: number;
}

export interface AgentTokenUsage {
  actorId: string;
  costMicros: number;
  inputTokens: number;
  outputTokens: number;
}

export interface WorkspaceTokenUsageSummary {
  agentCount: number;
  spentMicros: number;
}
