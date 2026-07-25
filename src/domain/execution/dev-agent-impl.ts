// Qual implementação de dev agent o engine sobe na fase de execução (Fase 4a).
// 'real' é o agente de produção (ToolLoop + LLM); 'noop' é o NoopDevAgentServer
// — pega uma task, cria worktree, escreve um arquivo trivial, commita e abre PR,
// sem LLM nenhum. Serve de smoke test determinístico e sem custo de token da
// infraestrutura de execução (worktree isolado, identidade dev-<modulo>[bot],
// pipeline de proposed_actions). Puro, sem IO.
export const DEV_AGENT_IMPLS = ['real', 'noop'] as const;

export type DevAgentImpl = (typeof DEV_AGENT_IMPLS)[number];

export const DEFAULT_DEV_AGENT_IMPL: DevAgentImpl = 'real';
