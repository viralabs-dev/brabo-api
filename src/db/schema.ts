// Nenhuma tabela ainda. A migração inicial (drizzle/0000_init_empty.sql) é
// intencionalmente vazia — só valida o pipeline de migração contra o
// Postgres compartilhado com o engine. Tabelas de domínio (workspaces,
// projetos, IAM, event log de sessões...) entram na Fase 1.
export {};
