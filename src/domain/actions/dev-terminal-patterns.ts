/**
 * Padrões de `permissions.json` que a ativação da execução (Fase 4a) libera
 * para os dev agents rodarem a suite de testes por conta própria.
 *
 * Por que isto existe: `Engine.Dev.Tools.ReportDone` só deixa o agente abrir PR
 * depois de um `terminal` com `exit 0` no histórico. Sem nenhuma regra no
 * arquivo, `decide()` cai no default `require_approval` e TODO `terminal` do
 * dev nasce pendente — ou seja, a suite verde é inalcançável e a task sempre
 * termina bloqueada por limite de iterações.
 *
 * Por que padrões estreitos em vez de `agent_autonomy` auto_approve pra
 * `terminal`: autonomia liberaria QUALQUER comando dentro do container do
 * engine. Aqui quem libera é o arquivo, então continua valendo que `deny`
 * vence `allow`, que os `BUILTIN_DENY_PATTERNS` (ver decide.ts) seguem ativos,
 * e que comando composto exige que CADA segmento case (decideFromPermissionsFile).
 *
 * O casamento é por PREFIXO de tokens (ver command-matcher.ts): `Terminal(pnpm
 * test)` cobre `pnpm test --run --reporter=json`, mas não `pnpm publish`.
 * Puro, sem IO.
 */
export const DEV_TERMINAL_ALLOW_PATTERNS: readonly string[] = [
  // Node / pnpm / npm / yarn
  'Terminal(pnpm install)',
  'Terminal(pnpm test)',
  'Terminal(pnpm run)',
  'Terminal(npm install)',
  'Terminal(npm test)',
  'Terminal(npm run)',
  'Terminal(npx vitest)',
  'Terminal(npx jest)',
  'Terminal(yarn install)',
  'Terminal(yarn test)',
  // Elixir
  'Terminal(mix deps.get)',
  'Terminal(mix test)',
  // Outras stacks comuns de projeto-cobaia
  'Terminal(pytest)',
  'Terminal(go test)',
  'Terminal(cargo test)',
];
