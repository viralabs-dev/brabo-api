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
  // LEITURA do próprio worktree — o que o agente faz ANTES de qualquer build.
  //
  // A lista cobria só build/teste, e isso bastava enquanto quem rodava era o
  // dev agent Noop. Com modelo de verdade, num repositório recém-provisionado
  // (só o template de PR e a política de branches), o primeiro instinto dele é
  // olhar em volta: `ls -la`, `find .`, `pwd`. Cada um caía em
  // `require_approval`, voltava do tool-result como `status pending` — e não
  // como a saída do comando — e queimava uma iteração. Numa execução real ele
  // morreu em `toolloop.limit_reached {iteration: 8, max_iterations: 8}` sem
  // ter escrito uma linha, e nunca chegou perto de um `pnpm test`.
  //
  // Todos são de leitura e não alteram nada. O que protege não é a inocência do
  // verbo, é o resto do mecanismo continuar valendo: `deny` vence `allow`, os
  // `BUILTIN_DENY_PATTERNS` seguem ativos, o comando roda no worktree do
  // próprio agente, e comando composto exige que CADA segmento case — então
  // `ls && rm -rf /` não passa por causa do `ls`.
  'Terminal(ls)',
  'Terminal(pwd)',
  'Terminal(find)',
  'Terminal(cat)',
  'Terminal(head)',
  'Terminal(tail)',
  'Terminal(grep)',
  'Terminal(wc)',
  'Terminal(echo)',
  'Terminal(git status)',
  'Terminal(git diff)',
  'Terminal(git log)',

  // Subcomandos de LEITURA que a exploração real de uma sessão mostrou em
  // falta: `git status`/`diff`/`log` bastam pra olhar o worktree, mas não pra
  // o agente se orientar no HISTÓRICO e nos REMOTOS de um repo recém-adotado
  // (`git branch -a`, `git remote -v`, `git worktree list`, `git show
  // origin/dev --stat`, `git for-each-ref`, `git ls-tree -r origin/dev
  // --name-only`, `git config user.name`) — cada um caiu fora do allow e, como
  // aparecem no MEIO de uma cadeia exploratória composta, reprovavam o
  // comando inteiro para aprovação manual.
  //
  // O casamento de `terminal` é por PREFIXO de tokens (ver
  // command-matcher.ts) — tokens extras no FINAL do comando são permitidos,
  // não só os que o padrão lista. Isso é seguro para verbos cuja família
  // INTEIRA é leitura (`git show`, `git log`, `git for-each-ref`, `git
  // ls-tree`, `git rev-parse`: nenhuma continuação deles muta o repo), mas
  // vira BURACO pros verbos com irmão mutante que aceita a MESMA forma
  // truncada — `Terminal(git branch)` bateria em `git branch -D nome`
  // (apaga) e em `git branch nome-nova` (cria) do mesmo jeito que bate em
  // `git branch` sozinho, porque o padrão não vê o que vem depois do prefixo
  // que ele checou. Por isso os quatro abaixo são ANCORADOS pela flag que
  // torna a leitura inequívoca, nunca pelo verbo pelado:
  //   - `git branch` sozinho poderia ganhar um nome de branch (cria) ou
  //     -D/-d/-m/-M (apaga/renomeia) depois do prefixo — ancorado em
  //     -a/-r/-v/--list/--show-current, que não aceitam continuação mutante.
  //   - `git remote` sozinho poderia ganhar `add`/`remove`/`set-url` — só
  //     `-v` e `show` (que só aceita nome de remote depois, sempre leitura).
  //   - `git worktree` sozinho poderia ganhar `add`/`remove`/`prune` — só
  //     `list`.
  //   - `git config` sozinho poderia ganhar um SEGUNDO argumento após a
  //     chave (`git config user.name "novo"` é ESCRITA; `git config
  //     user.name` sem mais nada é leitura, e o mecanismo de prefixo não
  //     distingue "sem mais tokens" de "com mais um token" — ver achado
  //     análogo em `git branch`). Só `--get` é ancorado, porque essa flag é
  //     o único jeito de o próprio git garantir leitura independente do que
  //     vier depois (chave, ou chave + padrão de valor pra filtrar). Isso
  //     deixa `git config user.name`/`git config --global ...` FORA da
  //     allowlist de propósito — granularidade que o casamento por prefixo
  //     já suporta, sem inventar parser de "conta quantos argumentos" novo.
  'Terminal(git branch -a)',
  'Terminal(git branch -r)',
  'Terminal(git branch -v)',
  'Terminal(git branch --list)',
  'Terminal(git branch --show-current)',
  'Terminal(git remote -v)',
  'Terminal(git remote show)',
  'Terminal(git worktree list)',
  'Terminal(git show)',
  'Terminal(git for-each-ref)',
  'Terminal(git ls-tree)',
  'Terminal(git rev-parse)',
  'Terminal(git config --get)',

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
