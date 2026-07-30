// A ORIGEM de uma falha de agente (ADR 0020, retomado no ADR 0038): nunca
// por eliminação, sempre nomeada — "infra" quando o provider/rede falhou,
// "modelo" quando o LLM parou sem concluir, "codigo" quando o problema está
// no que foi gerado/validado, "politica" quando um teto (orçamento, ciclo de
// correção) foi atingido por decisão de configuração, não por falha real.
//
// Vive como tipo próprio, não como union inline, porque o retrofit da Fase
// 8b (delegações da área de QA, e só elas — os pontos de bloqueio da Fase 4a
// não foram retrofitados nesta entrega) importa este mesmo tipo em vários
// lugares: schema, DTOs, use-cases. Um lugar só define o vocabulário.
export const FAILURE_ORIGINS = [
  'infra',
  'modelo',
  'codigo',
  'politica',
] as const;

export type FailureOrigin = (typeof FAILURE_ORIGINS)[number];

export function isFailureOrigin(value: unknown): value is FailureOrigin {
  return (
    typeof value === 'string' &&
    (FAILURE_ORIGINS as readonly string[]).includes(value)
  );
}
