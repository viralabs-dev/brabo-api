// O schema mora em `db/schema/`, um arquivo por AGREGADO de domínio —
// espelhando as pastas de `src/domain/*` em vez de uma taxonomia nova (ADR
// 0121). Este arquivo continua sendo o ponto de entrada: os 144 módulos que
// importam de `db/schema` (46 em `src/`, 98 em `test/` e `scripts/`) não
// mudaram uma linha, e o `drizzle-kit` continua
// enxergando as 51 tabelas e 34 enums por aqui.
//
// A ordem abaixo é a do arquivo antigo — identidade, sessão, LLM, ações,
// agentes e daí para as bordas —, não alfabética: ela é o índice de leitura do
// schema. Arquivo novo entra onde o assunto entra, não no fim.
export * from './schema/iam';
export * from './schema/sessions';
export * from './schema/llm';
export * from './schema/actions';
export * from './schema/agents';
export * from './schema/instructions';
export * from './schema/backlog';
export * from './schema/architecture';
export * from './schema/git';
export * from './schema/psychologist';
export * from './schema/anamnese';
export * from './schema/auth';
export * from './schema/rag';
export * from './schema/containers';
export * from './schema/huggingface';
export * from './schema/backup';
